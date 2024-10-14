import type { GasPriceManager } from "@alto/handlers"
import {
    type Address,
    CallEngineAbi,
    type HexData,
    type HexData32
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import { Semaphore } from "async-mutex"
import {
    type Account,
    type PublicClient,
    type TransactionReceipt,
    formatEther,
    getContract
} from "viem"
import type { AltoConfig } from "../createConfig"

const waitForTransactionReceipt = async (
    publicClient: PublicClient,
    tx: HexData32
): Promise<TransactionReceipt> => {
    try {
        return await publicClient.waitForTransactionReceipt({ hash: tx })
    } catch {
        return await waitForTransactionReceipt(publicClient, tx)
    }
}

export class SenderManager {
    private config: AltoConfig
    wallets: Account[]
    utilityAccount: Account | undefined
    availableWallets: Account[]
    private metrics: Metrics
    private semaphore: Semaphore
    private gasPriceManager: GasPriceManager
    private logger: Logger

    constructor({
        config,
        metrics,
        gasPriceManager
    }: {
        config: AltoConfig
        metrics: Metrics
        gasPriceManager: GasPriceManager
    }) {
        this.config = config
        this.logger = config.getLogger(
            { module: "executor" },
            {
                level: config.executorLogLevel || config.logLevel
            }
        )

        const maxSigners = config.maxExecutors
        const wallets = config.executorPrivateKeys

        if (maxSigners !== undefined && wallets.length > maxSigners) {
            this.wallets = wallets.slice(0, maxSigners)
            this.availableWallets = wallets.slice(0, maxSigners)
        } else {
            this.wallets = wallets
            this.availableWallets = wallets
        }

        this.utilityAccount = this.config.utilityPrivateKey
        this.metrics = metrics
        metrics.walletsAvailable.set(this.availableWallets.length)
        metrics.walletsTotal.set(this.wallets.length)
        this.semaphore = new Semaphore(this.availableWallets.length)
        this.gasPriceManager = gasPriceManager
    }

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
    async validateAndRefillWallets(): Promise<void> {
        const minBalance = this.config.minExecutorBalance

        if (!(minBalance && this.utilityAccount)) {
            return
        }

        const utilityWalletBalance = await this.config.publicClient.getBalance({
            address: this.utilityAccount.address
        })

        const balancesMissing: Record<Address, bigint> = {}

        const balanceRequestPromises = this.availableWallets.map(
            async (wallet) => {
                const balance = await this.config.publicClient.getBalance({
                    address: wallet.address
                })

                this.metrics.executorWalletsBalances.set(
                    {
                        wallet: wallet.address
                    },
                    Number.parseFloat(formatEther(balance))
                )

                if (balance < minBalance) {
                    const missingBalance = (minBalance * 6n) / 5n - balance
                    balancesMissing[wallet.address] = missingBalance
                }
            }
        )

        await Promise.all(balanceRequestPromises)

        const totalBalanceMissing = Object.values(balancesMissing).reduce(
            (a, b) => a + b,
            0n
        )
        if (utilityWalletBalance < (totalBalanceMissing * 11n) / 10n) {
            this.logger.info(
                { balancesMissing, totalBalanceMissing },
                "balances missing"
            )
            this.logger.error(
                {
                    minBalance,
                    utilityWalletBalance,
                    totalBalanceMissing,
                    utilityAccount: this.utilityAccount.address
                },
                "utility wallet has insufficient balance to refill wallets"
            )
            throw new Error(
                `utility wallet ${
                    this.utilityAccount.address
                } has insufficient balance ${formatEther(
                    utilityWalletBalance
                )} < ${formatEther(totalBalanceMissing)}`
            )
        }

        if (Object.keys(balancesMissing).length > 0) {
            const { maxFeePerGas, maxPriorityFeePerGas } =
                await this.gasPriceManager.getGasPrice()

            if (
                this.config.walletClient.chain.id === 59140 ||
                this.config.walletClient.chain.id === 137 ||
                this.config.walletClient.chain.id === 10
            ) {
                const instructions = []
                for (const [address, missingBalance] of Object.entries(
                    balancesMissing
                )) {
                    instructions.push({
                        to: address as Address,
                        value: missingBalance,
                        data: "0x" as HexData
                    })
                }

                let refillAddress: `0x${string}`
                if (this.config.walletClient.chain.id === 59140) {
                    refillAddress = "0xEad1aC3DF6F96b91491d6396F4d1610C5638B4Db"
                } else if (this.config.walletClient.chain.id === 137) {
                    refillAddress = "0x3402DB43152dAB9ab72fa805fdD5f391cD3E3822"
                } else {
                    refillAddress = "0x3402DB43152dAB9ab72fa805fdD5f391cD3E3822"
                }

                const callEngine = getContract({
                    abi: CallEngineAbi,
                    address: refillAddress,
                    client: {
                        public: this.config.publicClient,
                        wallet: this.config.walletClient
                    }
                })
                const tx = await callEngine.write.execute([instructions], {
                    account: this.utilityAccount,
                    value: totalBalanceMissing,
                    maxFeePerGas: maxFeePerGas * 2n,
                    maxPriorityFeePerGas: maxPriorityFeePerGas * 2n
                })

                await waitForTransactionReceipt(this.config.publicClient, tx)

                for (const [address, missingBalance] of Object.entries(
                    balancesMissing
                )) {
                    this.logger.info(
                        { tx, executor: address, missingBalance },
                        "refilled wallet"
                    )
                }
            } else {
                for (const [address, missingBalance] of Object.entries(
                    balancesMissing
                )) {
                    const tx = await this.config.walletClient.sendTransaction({
                        account: this.utilityAccount,
                        // @ts-ignore
                        to: address,
                        value: missingBalance,
                        maxFeePerGas: this.config.legacyTransactions
                            ? undefined
                            : maxFeePerGas,
                        maxPriorityFeePerGas: this.config.legacyTransactions
                            ? undefined
                            : maxPriorityFeePerGas,
                        gasPrice: this.config.legacyTransactions
                            ? maxFeePerGas
                            : undefined
                    })

                    await waitForTransactionReceipt(
                        this.config.publicClient,
                        tx
                    )
                    this.logger.info(
                        { tx, executor: address, missingBalance },
                        "refilled wallet"
                    )
                }
            }
        } else {
            this.logger.info("no wallets need to be refilled")
        }
    }

    async getWallet(): Promise<Account> {
        this.logger.trace(
            `waiting for semaphore with count ${this.semaphore.getValue()}`
        )
        await this.semaphore.waitForUnlock()
        await this.semaphore.acquire()
        const wallet = this.availableWallets.shift()

        // should never happen because of semaphore
        if (!wallet) {
            this.semaphore.release()
            this.logger.error("no more wallets")
            throw new Error("no more wallets")
        }

        this.logger.trace(
            { executor: wallet.address },
            "got wallet from sender manager"
        )

        this.metrics.walletsAvailable.set(this.availableWallets.length)

        return wallet
    }

    pushWallet(wallet: Account): void {
        this.availableWallets.push(wallet)
        this.semaphore.release()
        this.logger.trace(
            { executor: wallet.address },
            "pushed wallet to sender manager"
        )
        this.metrics.walletsAvailable.set(this.availableWallets.length)
        return
    }
}
