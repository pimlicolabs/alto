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

const sendRefillTransaction = async ({
    config,
    utilityAccount,
    executorAddress,
    minBalance,
    gasPriceManager,
    logger
}: {
    config: AltoConfig
    utilityAccount: Account
    executorAddress: Address
    minBalance: bigint
    gasPriceManager: GasPriceManager
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

    // Fetch gasPrice and bump by 150% to account for network fluctuations
    const gasPrice = await gasPriceManager.tryGetNetworkGasPrice()
    const maxFeePerGas = scaleBigIntByPercent(gasPrice.maxFeePerGas, 150n)
    const maxPriorityFeePerGas = scaleBigIntByPercent(
        gasPrice.maxPriorityFeePerGas,
        150n
    )

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
            // Top up to 120% of minBalance
            const missingBalance =
                scaleBigIntByPercent(minBalance, 120n) - balance
            balancesMissing.set(wallet.address, missingBalance)
        }
    })
    await Promise.all(balanceRequestPromises)

    if (balancesMissing.size === 0) {
        logger.info("no wallets need to be refilled")
        metrics.utilityWalletInsufficientBalance.set(0)
        metrics.utilityWalletMissingBalance.set(0)
        return
    }

    // Sort smallest to largest to refill as many wallets as possible
    const sorted = [...balancesMissing.entries()].sort((a, b) =>
        a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
    )

    for (const [executorAddress] of sorted) {
        try {
            await sendRefillTransaction({
                config,
                utilityAccount,
                executorAddress,
                minBalance,
                gasPriceManager,
                logger
            })
        } catch (e) {
            if (e instanceof BaseError) {
                const isInsufficientFunds = e.walk(
                    (err) => err instanceof InsufficientFundsError
                )
                if (isInsufficientFunds) {
                    logger.warn(
                        { executor: executorAddress },
                        "insufficient utility funds"
                    )
                    break
                }
            }
            logger.error({ err: e }, "failed to refill wallet")
        }
    }

    // Check if any wallets are still missing funds, and update metrics.
    let remainingMissing = 0n
    for (const [address] of sorted) {
        const balance = await config.publicClient.getBalance({ address })
        if (balance < minBalance) {
            remainingMissing += minBalance - balance
        }
    }

    if (remainingMissing > 0n) {
        metrics.utilityWalletInsufficientBalance.set(1)
        metrics.utilityWalletMissingBalance.set(
            Number.parseFloat(formatEther(remainingMissing))
        )
    } else {
        metrics.utilityWalletInsufficientBalance.set(0)
        metrics.utilityWalletMissingBalance.set(0)
    }
}
