import { Address, HexData32 } from "@alto/types"
import { Logger } from "@alto/utils"
import { Semaphore } from "async-mutex"

import { Account, PublicClient, formatEther, WalletClient, Chain, Transport, TransactionReceipt } from "viem"

const waitForTransactionReceipt = async (publicClient: PublicClient, tx: HexData32): Promise<TransactionReceipt> => {
    try {
        return await publicClient.waitForTransactionReceipt({ hash: tx })
    } catch {
        return await waitForTransactionReceipt(publicClient, tx)
    }
}

export class SenderManager {
    wallets: Account[]
    logger: Logger
    private semaphore: Semaphore

    constructor(wallets: Account[], logger: Logger, maxSigners?: number) {
        if (maxSigners !== undefined && wallets.length > maxSigners) {
            this.wallets = wallets.slice(0, maxSigners)
        } else {
            this.wallets = wallets
        }

        this.logger = logger
        this.semaphore = new Semaphore(this.wallets.length)
    }

    async validateWallets(publicClient: PublicClient, minBalance: bigint): Promise<void> {
        const promises = this.wallets.map(async (wallet) => {
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
        minBalance: bigint,
        utilityAccount: Account
    ): Promise<void> {
        const utilityWalletBalance = await publicClient.getBalance({ address: utilityAccount.address })

        const balancesMissing: Record<Address, bigint> = {}

        const balanceRequestPromises = this.wallets.map(async (wallet) => {
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
                `utility wallet ${utilityAccount.address} has insufficient balance ${formatEther(
                    utilityWalletBalance
                )} < ${formatEther(totalBalanceMissing)}`
            )
        }

        if (Object.keys(balancesMissing).length > 0) {
            for (const [address, missingBalance] of Object.entries(balancesMissing)) {
                const tx = await walletClient.sendTransaction({
                    account: utilityAccount,
                    // @ts-ignore
                    to: address,
                    value: missingBalance
                })

                await waitForTransactionReceipt(publicClient, tx)
                this.logger.info({ tx, executor: address, missingBalance }, "refilled wallet")
            }
        } else {
            this.logger.info("no wallets need to be refilled")
        }
    }

    async getWallet(): Promise<Account> {
        this.logger.trace(`waiting for semaphore with count ${this.semaphore.getValue()}`)
        await this.semaphore.waitForUnlock()
        await this.semaphore.acquire()
        const wallet = this.wallets.shift()

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
        this.wallets.push(wallet)
        this.semaphore.release()
        this.logger.trace({ executor: wallet.address }, "pushed wallet to sender manager")
        return
    }
}
