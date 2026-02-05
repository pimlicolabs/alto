import type { Metrics } from "@alto/utils"
import {
    type Address,
    type BaseError,
    InsufficientFundsError,
    formatEther
} from "viem"
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

        const entries = Object.entries(balancesMissing) as [Address, bigint][]

        let funded = 0n
        // Sequential direct sends; stop when funds run out
        for (const [address, missingBalance] of entries) {
            try {
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
                funded += missingBalance
            } catch (e) {
                const err = e as BaseError
                if (err instanceof InsufficientFundsError) {
                    logger.warn(
                        { executor: address, missingBalance },
                        "stopping refills due to insufficient utility funds"
                    )
                    break
                }
                logger.error(e, "failed to refill wallet")
            }
        }

        // Update visibility metrics after funding attempts
        const remainingMissing = totalBalanceMissing - funded
        metrics.utilityWalletInsufficientBalance.set(
            remainingMissing > 0n ? 1 : 0
        )
        metrics.utilityWalletMissingBalance.set(
            Number.parseFloat(formatEther(remainingMissing))
        )
    } else {
        logger.info("no wallets need to be refilled")
        metrics.utilityWalletInsufficientBalance.set(0)
        metrics.utilityWalletMissingBalance.set(0)
    }
}
