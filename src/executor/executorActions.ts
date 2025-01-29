import type { AltoConfig } from "@alto/config"
import type { GasPriceManager } from "@alto/handlers"
import { CallEngineAbi, type HexData, type HexData32 } from "@alto/types"
import type { Metrics } from "@alto/utils"
import {
    type Account,
    type Address,
    formatEther,
    getContract,
    type PublicClient,
    type TransactionReceipt
} from "viem"
import { SenderManager } from "./senderManager"
import { flushStuckTransaction } from "./utils"

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

export async function flushOnStartUp({
    senderManager,
    config,
    gasPriceManager
}: {
    senderManager: SenderManager
    config: AltoConfig
    gasPriceManager: GasPriceManager
}): Promise<void> {
    const allWallets = new Set(senderManager.getAllWallets())

    const utilityWallet = config.utilityPrivateKey
    if (utilityWallet) {
        allWallets.add(utilityWallet)
    }

    const wallets = Array.from(allWallets)

    let gasPrice: {
        maxFeePerGas: bigint
        maxPriorityFeePerGas: bigint
    }

    const logger = config.getLogger({ module: "flush-on-startup" })

    try {
        gasPrice = await gasPriceManager.tryGetNetworkGasPrice()
    } catch (e) {
        logger.error({ error: e }, "error flushing stuck transaction")
        return
    }

    const promises = wallets.map((wallet) => {
        try {
            flushStuckTransaction(
                config.publicClient,
                config.walletClient,
                wallet,
                gasPrice.maxFeePerGas * 5n,
                logger
            )
        } catch (e) {
            logger.error({ error: e }, "error flushing stuck transaction")
        }
    })

    await Promise.all(promises)
}

export async function validateAndRefillWallets({
    config,
    gasPriceManager,
    metrics
}: {
    config: AltoConfig
    gasPriceManager: GasPriceManager
    metrics: Metrics
}): Promise<void> {
    const utilityAccount = config.utilityPrivateKey
    const minBalance = config.minExecutorBalance

    const maxSigners = config.maxExecutors

    let availableWallets: Account[]

    if (
        maxSigners !== undefined &&
        config.executorPrivateKeys.length > maxSigners
    ) {
        availableWallets = config.executorPrivateKeys.slice(0, maxSigners)
    } else {
        availableWallets = config.executorPrivateKeys
    }

    const logger = config.getLogger({ module: "validate-and-refill-wallets" })

    if (!(minBalance && utilityAccount)) {
        return
    }

    const utilityWalletBalance = await config.publicClient.getBalance({
        address: utilityAccount.address
    })

    const balancesMissing: Record<Address, bigint> = {}

    const balanceRequestPromises = availableWallets.map(async (wallet) => {
        const balance = await config.publicClient.getBalance({
            address: wallet.address
        })

        metrics.executorWalletsBalances.set(
            {
                wallet: wallet.address
            },
            Number.parseFloat(formatEther(balance))
        )

        if (balance < minBalance) {
            const missingBalance = (minBalance * 6n) / 5n - balance
            balancesMissing[wallet.address] = missingBalance
        }
    })

    await Promise.all(balanceRequestPromises)

    const totalBalanceMissing = Object.values(balancesMissing).reduce(
        (a, b) => a + b,
        0n
    )
    if (utilityWalletBalance < (totalBalanceMissing * 11n) / 10n) {
        logger.info(
            { balancesMissing, totalBalanceMissing },
            "balances missing"
        )
        logger.error(
            {
                minBalance,
                utilityWalletBalance,
                totalBalanceMissing,
                utilityAccount: utilityAccount.address
            },
            "utility wallet has insufficient balance to refill wallets"
        )
        throw new Error(
            `utility wallet ${
                utilityAccount.address
            } has insufficient balance ${formatEther(
                utilityWalletBalance
            )} < ${formatEther(totalBalanceMissing)}`
        )
    }

    if (Object.keys(balancesMissing).length > 0) {
        const { maxFeePerGas, maxPriorityFeePerGas } = await gasPriceManager
            .tryGetNetworkGasPrice()
            .catch((_) => ({
                maxFeePerGas: undefined,
                maxPriorityFeePerGas: undefined
            }))

        if (!maxFeePerGas || !maxPriorityFeePerGas) {
            logger.error(
                "Failed to refill wallets due to no gas price available."
            )
            return
        }

        if (config.refillHelperContract) {
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

            const callEngine = getContract({
                abi: CallEngineAbi,
                address: config.refillHelperContract,
                client: {
                    public: config.publicClient,
                    wallet: config.walletClient
                }
            })
            const tx = await callEngine.write.execute([instructions], {
                account: utilityAccount,
                value: totalBalanceMissing,
                maxFeePerGas: maxFeePerGas * 2n,
                maxPriorityFeePerGas: maxPriorityFeePerGas * 2n
            })

            await waitForTransactionReceipt(config.publicClient, tx)

            for (const [address, missingBalance] of Object.entries(
                balancesMissing
            )) {
                logger.info(
                    { tx, executor: address, missingBalance },
                    "refilled wallet"
                )
            }
        } else {
            for (const [address, missingBalance] of Object.entries(
                balancesMissing
            )) {
                const tx = await config.walletClient.sendTransaction({
                    account: utilityAccount,
                    // @ts-ignore
                    to: address,
                    value: missingBalance,
                    maxFeePerGas: config.legacyTransactions
                        ? undefined
                        : maxFeePerGas,
                    maxPriorityFeePerGas: config.legacyTransactions
                        ? undefined
                        : maxPriorityFeePerGas,
                    gasPrice: config.legacyTransactions
                        ? maxFeePerGas
                        : undefined
                })

                await waitForTransactionReceipt(config.publicClient, tx)
                logger.info(
                    { tx, executor: address, missingBalance },
                    "refilled wallet"
                )
            }
        }
    } else {
        logger.info("no wallets need to be refilled")
    }
}
