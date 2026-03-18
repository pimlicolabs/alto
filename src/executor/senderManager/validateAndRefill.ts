import type { Logger, Metrics } from "@alto/utils"
import { scaleBigIntByPercent } from "@alto/utils"
import Redis from "ioredis"
import {
    type Account,
    type Address,
    type Hex,
    BaseError,
    InsufficientFundsError,
    encodeFunctionData,
    erc20Abi,
    formatEther
} from "viem"
import { Addresses as TempoAddresses } from "viem/tempo"
import type { SenderManager } from "."
import type { AltoConfig } from "../../createConfig"
import type { GasPriceManager } from "../../handlers/gasPriceManager"

let redisClient: Redis | null = null

// Returns the wallet balance using ERC20 balanceOf for Tempo,
// native getBalance otherwise.
const getWalletBalance = async ({
    config,
    address
}: {
    config: AltoConfig
    address: Address
}): Promise<bigint> => {
    if (config.chainType === "tempo") {
        return await config.publicClient.readContract({
            address: TempoAddresses.pathUsd,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address]
        })
    }
    return await config.publicClient.getBalance({ address })
}

// Transfers funds to a wallet. Uses ERC20 transfer for Tempo,
// native value transfer otherwise.
const transferBalance = async ({
    config,
    from,
    to,
    amount,
    maxFeePerGas,
    maxPriorityFeePerGas
}: {
    config: AltoConfig
    from: Account
    to: Address
    amount: bigint
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
}): Promise<Hex> => {
    if (config.chainType === "tempo") {
        const data = encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [to, amount]
        })

        return await config.walletClients.public.sendTransaction({
            account: from,
            to: TempoAddresses.pathUsd,
            data,
            maxFeePerGas,
            maxPriorityFeePerGas
        })
    }

    return config.legacyTransactions
        ? await config.walletClients.public.sendTransaction({
              account: from,
              to,
              value: amount,
              gasPrice: maxFeePerGas
          })
        : await config.walletClients.public.sendTransaction({
              account: from,
              to,
              value: amount,
              maxFeePerGas,
              maxPriorityFeePerGas
          })
}

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
    const balance = await getWalletBalance({ config, address: executorAddress })

    if (balance >= minBalance) {
        return
    }

    // Top up to 120% of minBalance
    const refillAmount = scaleBigIntByPercent(minBalance, 120n) - balance

    const txHash = await transferBalance({
        config,
        from: utilityAccount,
        to: executorAddress,
        amount: refillAmount,
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

    // With horizontal scaling, use a Redis SET NX lock so only one instance
    // performs the balance check/refill per interval. Fail-open on Redis errors.
    if (config.enableHorizontalScaling && config.redisEndpoint) {
        if (!redisClient) {
            redisClient = new Redis(config.redisEndpoint)
        }

        const acquired = await redisClient
            .set(
                `${config.redisKeyPrefix}:${config.chainId}:wallet-refill-lock`,
                "1",
                "EX",
                Math.floor(config.executorRefillInterval / 2),
                "NX"
            )
            .catch((err: unknown) => {
                logger.warn(
                    { err },
                    "Redis lock check failed, proceeding with update"
                )
                return "OK"
            })

        if (acquired !== "OK") {
            return
        }
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
        const balance = await getWalletBalance({
            config,
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

    const utilityBalance = await getWalletBalance({
        config,
        address: utilityAccount.address
    })
    metrics.utilityWalletBalance.set(
        Number.parseFloat(formatEther(utilityBalance))
    )
}
