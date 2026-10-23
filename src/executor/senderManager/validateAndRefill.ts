import { aggregate3ValueAbi } from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
import { formatNativeBalance, scaleBigIntByPercent } from "@alto/utils"
import Redis from "ioredis"
import {
    type Account,
    type Address,
    BaseError,
    type Hex,
    InsufficientFundsError,
    encodeFunctionData,
    erc20Abi
} from "viem"
import { Addresses as TempoAddresses } from "viem/tempo"
import type { SenderManager } from "."
import type { AltoConfig } from "../../createConfig"
import type { GasPriceManager } from "../../handlers/gasPriceManager"

let redisClient: Redis | null = null

type Refill = {
    address: Address
    refillAmount: bigint
}

type RefillPlan = {
    refills: Refill[]
    insufficientBalance: boolean
}

// Selects which wallets to refill given the utility balance. Wallets with
// the largest deficit are prioritized and refills that no longer fit are
// skipped so the utility wallet funds as many wallets as it can afford.
const planRefills = ({
    balances,
    minBalance,
    utilityBalance,
    refillTxGasCost
}: {
    balances: { address: Address; balance: bigint }[]
    minBalance: bigint
    utilityBalance: bigint
    refillTxGasCost: bigint
}): RefillPlan => {
    // Top up wallets below minBalance to 120% of minBalance
    const candidates: Refill[] = balances
        .filter(({ balance }) => balance < minBalance)
        .sort((a, b) => (a.balance < b.balance ? -1 : 1))
        .map(({ address, balance }) => ({
            address,
            refillAmount: scaleBigIntByPercent(minBalance, 120n) - balance
        }))

    // Each refill costs the utility account gas on top of the value sent.
    // Reserve the gas cost per refill so the plan never commits the entire
    // balance and leaves the refill transactions themselves unpayable.
    const refills: Refill[] = []
    let total = 0n
    for (const candidate of candidates) {
        if (total + candidate.refillAmount + refillTxGasCost <= utilityBalance) {
            refills.push(candidate)
            total += candidate.refillAmount + refillTxGasCost
        }
    }

    return {
        refills,
        insufficientBalance: refills.length < candidates.length
    }
}

let isMulticall3Deployed: boolean | null = null

// Batching is only possible for native transfers (Multicall3 would be
// msg.sender for ERC20 transfers) and when Multicall3 is deployed.
const canBatchRefills = async (config: AltoConfig): Promise<boolean> => {
    if (config.chainType === "tempo") {
        return false
    }

    if (isMulticall3Deployed === null) {
        try {
            const code = await config.publicClient.getCode({
                address: config.multicall3Address
            })
            isMulticall3Deployed = !!code && code !== "0x"
        } catch {
            // Leave as null so the check is retried next time.
            return false
        }
    }

    return isMulticall3Deployed
}

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

// Refills a single wallet with a direct transfer from the utility account.
const sendRefillTransaction = async ({
    config,
    utilityAccount,
    refill,
    maxFeePerGas,
    maxPriorityFeePerGas,
    logger
}: {
    config: AltoConfig
    utilityAccount: Account
    refill: Refill
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
    logger: Logger
}) => {
    const txHash = await transferBalance({
        config,
        from: utilityAccount,
        to: refill.address,
        amount: refill.refillAmount,
        maxFeePerGas,
        maxPriorityFeePerGas
    })

    await config.publicClient.waitForTransactionReceipt({
        hash: txHash
    })

    logger.info(
        {
            txHash,
            executorAddress: refill.address,
            refillAmount: refill.refillAmount
        },
        "refilled wallet"
    )
}

// Refills all wallets in a single transaction through Multicall3.
const sendBatchRefillTransaction = async ({
    config,
    utilityAccount,
    refills,
    maxFeePerGas,
    maxPriorityFeePerGas,
    logger
}: {
    config: AltoConfig
    utilityAccount: Account
    refills: Refill[]
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
    logger: Logger
}) => {
    // Create calldata
    const calls = refills.map(({ address, refillAmount }) => ({
        target: address,
        allowFailure: false,
        value: refillAmount,
        callData: "0x" as Hex
    }))

    const totalValue = refills.reduce(
        (sum, { refillAmount }) => sum + refillAmount,
        0n
    )

    const data = encodeFunctionData({
        abi: aggregate3ValueAbi,
        functionName: "aggregate3Value",
        args: [calls]
    })

    const txHash = config.legacyTransactions
        ? await config.walletClients.public.sendTransaction({
              account: utilityAccount,
              to: config.multicall3Address,
              data,
              value: totalValue,
              gasPrice: maxFeePerGas
          })
        : await config.walletClients.public.sendTransaction({
              account: utilityAccount,
              to: config.multicall3Address,
              data,
              value: totalValue,
              maxFeePerGas,
              maxPriorityFeePerGas
          })

    await config.publicClient.waitForTransactionReceipt({
        hash: txHash
    })

    logger.info(
        {
            txHash,
            executorAddresses: refills.map(({ address }) => address),
            totalRefillAmount: totalValue
        },
        "refilled wallets through multicall3"
    )
}

const isInsufficientFundsError = (e: unknown): boolean => {
    if (e instanceof BaseError) {
        return !!e.walk((err) => err instanceof InsufficientFundsError)
    }
    return false
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

    // With horizontal scaling, a Redis SET NX lock ensures only one instance
    // refills per interval. Non-winners remove their wallet gauge samples so
    // only the latest winner exposes values.
    if (config.enableHorizontalScaling && config.redisEndpoint) {
        if (!redisClient) {
            redisClient = new Redis(config.redisEndpoint)
        }

        // TTL must cover most of the refill interval: at half the interval a
        // second instance ticking later in the same interval can acquire the
        // lock and refill twice per interval.
        const acquired = await redisClient
            .set(
                `${config.redisKeyPrefix}:${config.chainId}:wallet-refill-lock`,
                "1",
                "EX",
                Math.max(1, Math.floor(config.executorRefillInterval * 0.9)),
                "NX"
            )
            .catch((err: unknown) => {
                // The lock exists to prevent duplicate fund movements. If we
                // cannot verify exclusivity, skip this interval instead of
                // refilling concurrently on every scaled instance. Wallets
                // still hold their remaining balance, so a skipped interval
                // is recoverable; duplicated refills are not free.
                logger.warn(
                    { err },
                    "Redis lock check failed, skipping refill this interval"
                )
                return null
            })

        if (acquired !== "OK") {
            metrics.utilityWalletBalance.remove()
            metrics.utilityWalletInsufficientBalance.remove()
            metrics.utilityWalletMissingBalance.remove()
            metrics.executorWalletsBalances.reset()
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

    const balances = await Promise.all(
        allWallets.map(async (wallet) => ({
            address: wallet.address,
            balance: await getWalletBalance({
                config,
                address: wallet.address
            })
        }))
    )

    // Only send refills that fit within the utility wallet balance so a
    // shortfall degrades to a partial refill instead of a failed batch.
    const utilityBalance = await getWalletBalance({
        config,
        address: utilityAccount.address
    })

    // Gas budget the utility account must keep per refill transaction.
    // Native transfers cost 21k gas; tempo ERC20 transfers need more.
    const refillTxGasLimit = config.chainType === "tempo" ? 100_000n : 21_000n
    const refillTxGasCost = refillTxGasLimit * maxFeePerGas

    const { refills, insufficientBalance } = planRefills({
        balances,
        minBalance,
        utilityBalance,
        refillTxGasCost
    })

    if (insufficientBalance) {
        logger.warn(
            {
                utilityBalance,
                shortfallCount: balances.filter(
                    ({ balance }) => balance < minBalance
                ).length,
                fundedCount: refills.length
            },
            "utility balance insufficient for full refill, sending partial refill"
        )
    }

    let hitInsufficientFundsError = false

    if (refills.length > 0 && (await canBatchRefills(config))) {
        try {
            await sendBatchRefillTransaction({
                config,
                utilityAccount,
                refills,
                maxFeePerGas,
                maxPriorityFeePerGas,
                logger
            })
        } catch (e) {
            if (isInsufficientFundsError(e)) {
                hitInsufficientFundsError = true
                logger.warn(
                    { executors: refills.map(({ address }) => address) },
                    "insufficient utility funds"
                )
            } else {
                logger.error({ err: e }, "failed to batch refill wallets")
            }
        }
    } else {
        for (const refill of refills) {
            try {
                await sendRefillTransaction({
                    config,
                    utilityAccount,
                    refill,
                    maxFeePerGas,
                    maxPriorityFeePerGas,
                    logger
                })
            } catch (e) {
                if (isInsufficientFundsError(e)) {
                    hitInsufficientFundsError = true
                    logger.warn(
                        { executor: refill.address },
                        "insufficient utility funds"
                    )
                    break
                }
                logger.error({ err: e }, "failed to refill wallet")
            }
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
            formatNativeBalance({ value: balance, config })
        )

        if (balance < minBalance) {
            remainingMissing += minBalance - balance
        }
    }

    if (remainingMissing === 0n) {
        logger.info("no wallets need to be refilled")
        metrics.utilityWalletMissingBalance.set(0)
    } else {
        metrics.utilityWalletMissingBalance.set(
            formatNativeBalance({ value: remainingMissing, config })
        )
    }

    // Set when the utility wallet could not cover this refill pass, either
    // detected upfront during planning or by the transaction failing.
    metrics.utilityWalletInsufficientBalance.set(
        insufficientBalance || hitInsufficientFundsError ? 1 : 0
    )

    const remainingUtilityBalance = await getWalletBalance({
        config,
        address: utilityAccount.address
    })
    metrics.utilityWalletBalance.set(
        formatNativeBalance({ value: remainingUtilityBalance, config })
    )
}
