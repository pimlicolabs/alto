import type { GasPriceManager, Logger, Metrics } from "@alto/utils"
import {
    type Address,
    CallEngineAbi,
    type HexData,
    type HexData32
} from "@entrypoint-0.6/types"
import type { ApiVersion } from "@entrypoint-0.6/types"
import { Semaphore } from "async-mutex"
import {
    type Account,
    type Chain,
    type PublicClient,
    type TransactionReceipt,
    type Transport,
    type WalletClient,
    formatEther,
    getContract
} from "viem"

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
    wallets: Account[]
    utilityAccount: Account
    availableWallets: Account[]
    private logger: Logger
    private metrics: Metrics
    private noEip1559Support: boolean
    private semaphore: Semaphore
    private apiVersion: ApiVersion
    private gasPriceManager: GasPriceManager

    constructor(
        wallets: Account[],
        utilityAccount: Account,
        logger: Logger,
        metrics: Metrics,
        noEip1559Support: boolean,
        apiVersion: ApiVersion,
        gasPriceManager: GasPriceManager,
        maxSigners?: number
    ) {
        if (maxSigners !== undefined && wallets.length > maxSigners) {
            this.wallets = wallets.slice(0, maxSigners)
            this.availableWallets = wallets.slice(0, maxSigners)
        } else {
            this.wallets = wallets
            this.availableWallets = wallets
        }

        this.utilityAccount = utilityAccount
        this.logger = logger
        this.metrics = metrics
        this.noEip1559Support = noEip1559Support
        metrics.walletsAvailable.set(this.availableWallets.length)
        metrics.walletsTotal.set(this.wallets.length)
        this.semaphore = new Semaphore(this.availableWallets.length)
        this.apiVersion = apiVersion
        this.gasPriceManager = gasPriceManager
    }

    async validateWallets(
        publicClient: PublicClient,
        minBalance: bigint
    ): Promise<void> {
        const promises = this.availableWallets.map(async (wallet) => {
            const balance = await publicClient.getBalance({
                address: wallet.address
            })

            if (balance < minBalance) {
                this.logger.error(
                    {
                        balance,
                        requiredBalance: minBalance,
                        executor: wallet.address
                    },
                    "wallet has insufficient balance"
                )
                throw new Error(
                    `wallet ${
                        wallet.address
                    } has insufficient balance ${formatEther(
                        balance
                    )} < ${formatEther(minBalance)}`
                )
            }
        })

        await Promise.all(promises)
    }

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
    async validateAndRefillWallets(
        publicClient: PublicClient,
        walletClient: WalletClient<Transport, Chain>,
        minBalance: bigint
    ): Promise<void> {
        const utilityWalletBalance = await publicClient.getBalance({
            address: this.utilityAccount.address
        })

        const balancesMissing: Record<Address, bigint> = {}

        const balanceRequestPromises = this.availableWallets.map(
            async (wallet) => {
                const balance = await publicClient.getBalance({
                    address: wallet.address
                })

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
                { utilityWalletBalance, totalBalanceMissing },
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
                walletClient.chain.id === 59140 ||
                walletClient.chain.id === 137 ||
                walletClient.chain.id === 10
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
                if (walletClient.chain.id === 59140) {
                    refillAddress = "0xEad1aC3DF6F96b91491d6396F4d1610C5638B4Db"
                } else if (walletClient.chain.id === 137) {
                    refillAddress = "0x3402DB43152dAB9ab72fa805fdD5f391cD3E3822"
                } else {
                    refillAddress = "0x3402DB43152dAB9ab72fa805fdD5f391cD3E3822"
                }

                const callEngine = getContract({
                    abi: CallEngineAbi,
                    address: refillAddress,
                    publicClient,
                    walletClient
                })
                const tx = await callEngine.write.execute([instructions], {
                    account: this.utilityAccount,
                    value: totalBalanceMissing,
                    maxFeePerGas: maxFeePerGas * 2n,
                    maxPriorityFeePerGas: maxPriorityFeePerGas * 2n
                })

                await waitForTransactionReceipt(publicClient, tx)

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
                    const tx = await walletClient.sendTransaction({
                        account: this.utilityAccount,
                        // @ts-ignore
                        to: address,
                        value: missingBalance,
                        maxFeePerGas: this.noEip1559Support
                            ? undefined
                            : maxFeePerGas,
                        maxPriorityFeePerGas: this.noEip1559Support
                            ? undefined
                            : maxPriorityFeePerGas,
                        gasPrice: this.noEip1559Support
                            ? maxFeePerGas
                            : undefined
                    })

                    await waitForTransactionReceipt(publicClient, tx)
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
        const wallet =
            this.apiVersion === "v1"
                ? this.availableWallets.shift()
                : this.availableWallets.pop()

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
        // push to the end of the queue
        this.apiVersion === "v1"
            ? this.availableWallets.push(wallet)
            : this.availableWallets.unshift(wallet)
        this.semaphore.release()
        this.logger.trace(
            { executor: wallet.address },
            "pushed wallet to sender manager"
        )
        this.metrics.walletsAvailable.set(this.availableWallets.length)
        return
    }
}
