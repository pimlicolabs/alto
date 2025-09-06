import { CallEngineAbi, type HexData } from "@alto/types"
import type { Metrics } from "@alto/utils"
import { type Address, formatEther, getContract } from "viem"
import type { SenderManager } from "."
import type { AltoConfig } from "../../createConfig"
import type { GasPriceManager } from "../../handlers/gasPriceManager"

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
export const validateAndRefillWallets = async ({
    metrics,
    config,
    senderManager,
    gasPriceManager
}: {
    config: AltoConfig
    senderManager: SenderManager
    metrics: Metrics
    gasPriceManager: GasPriceManager
}): Promise<void> => {
    const logger = config.getLogger(
        { module: "validate-and-refill-wallets" },
        { level: config.logLevel }
    )
    const minBalance = config.minExecutorBalance
    const utilityAccount = config.utilityPrivateKey

    if (!(minBalance && utilityAccount)) {
        return
    }

    const utilityWalletBalance = await config.publicClient.getBalance({
        address: utilityAccount.address
    })

    const balancesMissing: Record<Address, bigint> = {}

    const allWallets = senderManager.getAllWallets()
    const balanceRequestPromises = allWallets.map(async (wallet) => {
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
        metrics.utilityWalletInsufficientBalance.set(1)
        logger.error(
            {
                minBalance: formatEther(minBalance),
                utilityWalletBalance: formatEther(utilityWalletBalance),
                totalBalanceMissing: formatEther(totalBalanceMissing),
                minRefillAmount: formatEther(
                    totalBalanceMissing - utilityWalletBalance
                ),
                utilityAccount: utilityAccount.address
            },
            "utility wallet has insufficient balance to refill wallets"
        )
        return
    }

    metrics.utilityWalletInsufficientBalance.set(0)

    if (Object.keys(balancesMissing).length > 0) {
        let maxFeePerGas: bigint
        let maxPriorityFeePerGas: bigint
        try {
            const gasPriceParameters =
                await gasPriceManager.tryGetNetworkGasPrice()

            maxFeePerGas = gasPriceParameters.maxFeePerGas
            maxPriorityFeePerGas = gasPriceParameters.maxPriorityFeePerGas
        } catch (e) {
            logger.error(e, "No gas price available")
            return
        }

        if (config.refillHelperContract) {
            const instructions: {
                to: Address
                value: bigint
                data: HexData
            }[] = []
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
                    wallet: config.walletClients.public
                }
            })
            const tx = await callEngine.write.execute([instructions], {
                account: utilityAccount,
                value: totalBalanceMissing,
                maxFeePerGas: maxFeePerGas * 2n,
                maxPriorityFeePerGas: maxPriorityFeePerGas * 2n
            })

            await config.publicClient.waitForTransactionReceipt({ hash: tx })

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
                const tx = await config.walletClients.public.sendTransaction({
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

                await config.publicClient.waitForTransactionReceipt({
                    hash: tx
                })
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
