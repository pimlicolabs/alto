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

    const balancesMissing = new Map<Address, bigint>()

    const allWallets = senderManager.getAllWallets()

    // Get balances of all wallets
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
            balancesMissing.set(wallet.address, missingBalance)
        }
    })
    await Promise.all(balanceRequestPromises)

    const totalBalanceMissing = [...balancesMissing.values()].reduce(
        (a, b) => a + b,
        0n
    )

    if (balancesMissing.size === 0) {
        logger.info("no wallets need to be refilled")
        metrics.utilityWalletInsufficientBalance.set(0)
        metrics.utilityWalletMissingBalance.set(0)
        return
    }

    let maxFeePerGas: bigint
    let maxPriorityFeePerGas: bigint
    try {
        const gasPriceParameters = await gasPriceManager.tryGetNetworkGasPrice()

        maxFeePerGas = gasPriceParameters.maxFeePerGas
        maxPriorityFeePerGas = gasPriceParameters.maxPriorityFeePerGas
    } catch (e) {
        logger.error(e, "No gas price available")
        return
    }

    // Sort smallest to largest to refill as many wallets as possible
    const sorted = [...balancesMissing.entries()].sort((a, b) =>
        a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
    )

    let funded = 0n
    // Sequential direct sends; stop when funds run out
    for (const [executorAddress, missingBalance] of sorted) {
        try {
            const txHash = config.legacyTransactions
                ? await config.walletClients.public.sendTransaction({
                      account: utilityAccount,
                      to: executorAddress,
                      value: missingBalance,
                      gasPrice: maxFeePerGas
                  })
                : await config.walletClients.public.sendTransaction({
                      account: utilityAccount,
                      to: executorAddress,
                      value: missingBalance,
                      maxFeePerGas,
                      maxPriorityFeePerGas
                  })

            await config.publicClient.waitForTransactionReceipt({
                hash: txHash
            })

            logger.info(
                { txHash, executorAddress, missingBalance },
                "refilled wallet"
            )
            funded += missingBalance
        } catch (e) {
            const err = e as BaseError
            if (err instanceof InsufficientFundsError) {
                logger.warn(
                    { executor: executorAddress, missingBalance },
                    "stopping refills due to insufficient utility funds"
                )
                break
            }
            logger.error({ err }, "failed to refill wallet")
        }
    }

    // Update metrics after funding attempts
    const remainingMissing = totalBalanceMissing - funded
    metrics.utilityWalletInsufficientBalance.set(remainingMissing > 0n ? 1 : 0)
    metrics.utilityWalletMissingBalance.set(
        Number.parseFloat(formatEther(remainingMissing))
    )
}
