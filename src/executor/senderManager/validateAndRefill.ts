import type { Logger, Metrics } from "@alto/utils"
import { scaleBigIntByPercent } from "@alto/utils"
import {
    type Account,
    type Address,
    BaseError,
    InsufficientFundsError,
    formatEther
} from "viem"
import type { SenderManager } from "."
import type { AltoConfig } from "../../createConfig"
import type { GasPriceManager } from "../../handlers/gasPriceManager"

// Checks executor balance and refills to 120% of minBalance if below threshold.
const sendRefillTransaction = async ({
    config,
    utilityAccount,
    executorAddress,
    minBalance,
    maxFeePerGas,
    maxPriorityFeePerGas,
    logger
}: {
    config: AltoConfig
    utilityAccount: Account
    executorAddress: Address
    minBalance: bigint
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
    logger: Logger
}) => {
    const balance = await config.publicClient.getBalance({
        address: executorAddress
    })

    if (balance >= minBalance) {
        return
    }

    // Top up to 120% of minBalance
    const refillAmount = scaleBigIntByPercent(minBalance, 120n) - balance

    const txHash = config.legacyTransactions
        ? await config.walletClients.public.sendTransaction({
              account: utilityAccount,
              to: executorAddress,
              value: refillAmount,
              gasPrice: maxFeePerGas
          })
        : await config.walletClients.public.sendTransaction({
              account: utilityAccount,
              to: executorAddress,
              value: refillAmount,
              maxFeePerGas,
              maxPriorityFeePerGas
          })

    await config.publicClient.waitForTransactionReceipt({
        hash: txHash
    })

    logger.info({ txHash, executorAddress, refillAmount }, "refilled wallet")
}

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

    const allWallets = senderManager.getAllWallets()

    // Fetch gasPrice once and bump by 200% to account for fluctuations
    const gasPrice = await gasPriceManager.tryGetNetworkGasPrice({
        forExecutor: true
    })
    const maxFeePerGas = scaleBigIntByPercent(gasPrice.maxFeePerGas, 200n)
    const maxPriorityFeePerGas = scaleBigIntByPercent(
        gasPrice.maxPriorityFeePerGas,
        200n
    )

    for (const wallet of allWallets) {
        try {
            await sendRefillTransaction({
                config,
                utilityAccount,
                executorAddress: wallet.address,
                minBalance,
                maxFeePerGas,
                maxPriorityFeePerGas,
                logger
            })
        } catch (e) {
            if (e instanceof BaseError) {
                const isInsufficientFunds = e.walk(
                    (err) => err instanceof InsufficientFundsError
                )
                if (isInsufficientFunds) {
                    logger.warn(
                        { executor: wallet.address },
                        "insufficient utility funds"
                    )
                    break
                }
            }
            logger.error({ err: e }, "failed to refill wallet")
        }
    }

    let remainingMissing = 0n
    for (const wallet of allWallets) {
        const balance = await config.publicClient.getBalance({
            address: wallet.address
        })

        metrics.executorWalletsBalances.set(
            { wallet: wallet.address },
            Number.parseFloat(formatEther(balance))
        )

        if (balance < minBalance) {
            remainingMissing += minBalance - balance
        }
    }

    if (remainingMissing === 0n) {
        logger.info("no wallets need to be refilled")
        metrics.utilityWalletInsufficientBalance.set(0)
        metrics.utilityWalletMissingBalance.set(0)
    } else {
        metrics.utilityWalletInsufficientBalance.set(1)
        metrics.utilityWalletMissingBalance.set(
            Number.parseFloat(formatEther(remainingMissing))
        )
    }

    const utilityBalance = await config.publicClient.getBalance({
        address: utilityAccount.address
    })
    metrics.utilityWalletBalance.set(
        Number.parseFloat(formatEther(utilityBalance))
    )
}
