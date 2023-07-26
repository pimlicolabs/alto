import { Address, HexData, HexData32, CallEngineAbi } from "@alto/types"
import { Logger } from "@alto/utils"
import { Semaphore } from "async-mutex"

import {
    Account,
    PublicClient,
    formatEther,
    WalletClient,
    Chain,
    Transport,
    TransactionReceipt,
    getContract
} from "viem"
import { getGasPrice } from "./gasPrice"

const waitForTransactionReceipt = async (publicClient: PublicClient, tx: HexData32): Promise<TransactionReceipt> => {
    try {
        return await publicClient.waitForTransactionReceipt({ hash: tx })
    } catch {
        return await waitForTransactionReceipt(publicClient, tx)
    }
}

export class SenderManager {
    wallets: Account[]
    private availableWallets: Account[]
    logger: Logger
    private semaphore: Semaphore
    utilityAccount: Account

    constructor(wallets: Account[], utilityAccount: Account, logger: Logger, maxSigners?: number) {
        if (maxSigners !== undefined && wallets.length > maxSigners) {
            this.wallets = wallets.slice(0, maxSigners)
            this.availableWallets = wallets.slice(0, maxSigners)
        } else {
            this.wallets = wallets
            this.availableWallets = wallets
        }

        this.utilityAccount = utilityAccount
        this.logger = logger
        this.semaphore = new Semaphore(this.availableWallets.length)
    }

    async validateWallets(publicClient: PublicClient, minBalance: bigint): Promise<void> {
        const promises = this.availableWallets.map(async (wallet) => {
            const balance = await publicClient.getBalance({ address: wallet.address })

            if (balance < minBalance) {
                this.logger.error(
                    { balance, requiredBalance: minBalance, executor: wallet.address },
                    "wallet has insufficient balance"
                )
                throw new Error(
                    `wallet ${wallet.address} has insufficient balance ${formatEther(balance)} < ${formatEther(
                        minBalance
                    )}`
                )
            }
        })

        await Promise.all(promises)
    }

    async validateAndRefillWallets(
        publicClient: PublicClient,
        walletClient: WalletClient<Transport, Chain, undefined>,
        minBalance: bigint
    ): Promise<void> {
        const utilityWalletBalance = await publicClient.getBalance({ address: this.utilityAccount.address })

        const balancesMissing: Record<Address, bigint> = {}

        const balanceRequestPromises = this.availableWallets.map(async (wallet) => {
            const balance = await publicClient.getBalance({ address: wallet.address })

            if (balance < minBalance) {
                const missingBalance = minBalance - balance
                balancesMissing[wallet.address] = missingBalance
            }
        })

        await Promise.all(balanceRequestPromises)

        const totalBalanceMissing = (Object.values(balancesMissing).reduce((a, b) => a + b, 0n) * 6n) / 5n // 20% extra for gas
        if (utilityWalletBalance < totalBalanceMissing) {
            this.logger.info({ balancesMissing, totalBalanceMissing }, "balances missing")
            this.logger.error(
                { utilityWalletBalance, totalBalanceMissing },
                "utility wallet has insufficient balance to refill wallets"
            )
            throw new Error(
                `utility wallet ${this.utilityAccount.address} has insufficient balance ${formatEther(
                    utilityWalletBalance
                )} < ${formatEther(totalBalanceMissing)}`
            )
        }

        if (Object.keys(balancesMissing).length > 0) {
            const { maxFeePerGas, maxPriorityFeePerGas } = await getGasPrice(
                walletClient.chain.id,
                publicClient,
                this.logger
            )

            if (walletClient.chain.id === 59140 || walletClient.chain.id === 137) {
                const instructions = []
                for (const [address, missingBalance] of Object.entries(balancesMissing)) {
                    instructions.push({
                        to: address as Address,
                        value: missingBalance,
                        data: "0x" as HexData
                    })
                }

                let refillAddress: `0x${string}`
                if (walletClient.chain.id === 59140) {
                    refillAddress = "0xEad1aC3DF6F96b91491d6396F4d1610C5638B4Db"
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

                for (const [address, missingBalance] of Object.entries(balancesMissing)) {
                    this.logger.info({ tx, executor: address, missingBalance }, "refilled wallet")
                }
            } else {
                for (const [address, missingBalance] of Object.entries(balancesMissing)) {
                    const tx = await walletClient.sendTransaction({
                        account: this.utilityAccount,
                        // @ts-ignore
                        to: address,
                        value: (missingBalance * 12n) / 10n,
                        maxFeePerGas: maxFeePerGas,
                        maxPriorityFeePerGas: maxPriorityFeePerGas
                    })

                    await waitForTransactionReceipt(publicClient, tx)
                    this.logger.info({ tx, executor: address, missingBalance }, "refilled wallet")
                }
            }
        } else {
            this.logger.info("no wallets need to be refilled")
        }
    }

    async getWallet(): Promise<Account> {
        this.logger.trace(`waiting for semaphore with count ${this.semaphore.getValue()}`)
        await this.semaphore.waitForUnlock()
        await this.semaphore.acquire()
        const wallet = this.availableWallets.shift()

        // should never happen because of semaphore
        if (!wallet) {
            this.semaphore.release()
            this.logger.error("no more wallets")
            throw new Error("no more wallets")
        }

        this.logger.trace({ executor: wallet.address }, "got wallet from sender manager")

        return wallet
    }

    async pushWallet(wallet: Account): Promise<void> {
        // push to the end of the queue
        this.availableWallets.push(wallet)
        this.semaphore.release()
        this.logger.trace({ executor: wallet.address }, "pushed wallet to sender manager")
        return
    }
}
