import {
    type GasPriceParameters,
    RpcError,
    gasStationResult
} from "@alto/types"
import {
    type Logger,
    maxBigInt,
    minBigInt,
    scaleBigIntByPercent
} from "@alto/utils"
import * as sentry from "@sentry/node"
import type { Chain, PublicClient } from "viem"
import { polygon } from "viem/chains"
import type { AltoConfig } from "../createConfig"
import { type MinMaxQueue, createMinMaxQueue } from "../utils/minMaxQueue"
import { ArbitrumManager } from "./arbitrumGasPriceManager"
import { MantleManager } from "./mantleGasPriceManager"
import { OptimismManager } from "./optimismManager"

export class GasPriceManager {
    private readonly config: AltoConfig
    private readonly baseFeePerGasQueue: MinMaxQueue
    private readonly maxFeePerGasQueue: MinMaxQueue
    private readonly maxPriorityFeePerGasQueue: MinMaxQueue
    private readonly logger: Logger

    public readonly arbitrumManager: ArbitrumManager
    public readonly mantleManager: MantleManager
    public readonly optimismManager: OptimismManager

    constructor(config: AltoConfig) {
        this.config = config
        this.logger = config.getLogger(
            { module: "gas_price_manager" },
            {
                level: config.logLevel
            }
        )

        this.baseFeePerGasQueue = createMinMaxQueue({
            config,
            queueName: "base-fee-per-gas-queue"
        })
        this.maxFeePerGasQueue = createMinMaxQueue({
            config,
            queueName: "max-fee-per-gas-queue"
        })
        this.maxPriorityFeePerGasQueue = createMinMaxQueue({
            config,
            queueName: "max-priority-fee-per-gas-queue"
        })

        // Periodically update gas prices if specified
        if (this.config.gasPriceRefreshInterval > 0) {
            setInterval(async () => {
                try {
                    if (this.config.legacyTransactions === false) {
                        await this.tryUpdateBaseFee()
                    }

                    await this.tryUpdateGasPrice()
                } catch (err) {
                    this.logger.error(
                        { err },
                        "Error updating gas prices in interval"
                    )
                    sentry.captureException(err)
                }
            }, this.config.gasPriceRefreshInterval * 1000)
        }

        this.arbitrumManager = new ArbitrumManager({ config })
        this.mantleManager = new MantleManager({ config })
        this.optimismManager = new OptimismManager({ config })
    }

    public async init() {
        if (this.config.dynamicGasPrice) {
            this.logger.info(
                {
                    lookbackBlocks: this.config.dynamicGasPriceLookbackBlocks,
                    targetInclusionBlocks:
                        this.config.dynamicGasPriceTargetInclusionBlocks
                },
                "using dynamic gas pricing"
            )
        }

        try {
            await Promise.all([
                this.tryUpdateGasPrice(),
                this.config.legacyTransactions === false
                    ? this.tryUpdateBaseFee()
                    : Promise.resolve()
            ])
        } catch (err) {
            this.logger.error({ err }, "Error during gas price initialization")
        }
    }

    private async getPolygonGasPriceParameters(): Promise<GasPriceParameters | null> {
        const gasStationUrl = "https://gasstation.polygon.technology/v2"
        try {
            const data = await (await fetch(gasStationUrl)).json()
            // take the standard speed here, SDK options will define the extra tip
            const parsedData = gasStationResult.parse(data)

            return parsedData.fast
        } catch (e) {
            this.logger.error(
                { err: e },
                "failed to get gas price from gas station, using default"
            )
            return null
        }
    }

    private bumpTheGasPrice(
        gasPriceParameters: GasPriceParameters
    ): GasPriceParameters {
        let [maxFeePerGas, maxPriorityFeePerGas] = [
            gasPriceParameters.maxFeePerGas,
            gasPriceParameters.maxPriorityFeePerGas
        ]

        // Apply bump percentage
        maxPriorityFeePerGas = scaleBigIntByPercent(
            maxPriorityFeePerGas,
            this.config.gasPriceBump
        )
        maxFeePerGas = scaleBigIntByPercent(
            maxFeePerGas,
            this.config.gasPriceBump
        )

        // Apply floor values if configured
        if (this.config.floorMaxPriorityFeePerGas) {
            maxPriorityFeePerGas = maxBigInt(
                this.config.floorMaxPriorityFeePerGas,
                maxPriorityFeePerGas
            )
        }
        if (this.config.floorMaxFeePerGas) {
            maxFeePerGas = maxBigInt(
                this.config.floorMaxFeePerGas,
                maxFeePerGas
            )
        }

        return {
            // Ensure that maxFeePerGas is always greater or equal than maxPriorityFeePerGas
            maxFeePerGas: maxBigInt(maxFeePerGas, maxPriorityFeePerGas),
            maxPriorityFeePerGas
        }
    }

    private async getFallBackMaxPriorityFeePerGas(
        publicClient: PublicClient,
        gasPrice: bigint
    ): Promise<bigint> {
        const feeHistory = await publicClient.getFeeHistory({
            blockCount: 10,
            rewardPercentiles: [20],
            blockTag: "latest"
        })

        if (feeHistory.reward === undefined || feeHistory.reward === null) {
            return gasPrice
        }

        const feeAverage =
            feeHistory.reward.reduce((acc, cur) => cur[0] + acc, 0n) / 10n
        return minBigInt(feeAverage, gasPrice)
    }

    private async getLegacyTransactionGasPrice(): Promise<GasPriceParameters> {
        let gasPrice: bigint | undefined
        try {
            const gasInfo = await this.config.publicClient.estimateFeesPerGas({
                chain: this.config.publicClient.chain,
                type: "legacy"
            })
            gasPrice = gasInfo.gasPrice
        } catch (e) {
            sentry.captureException(e)
            this.logger.error(
                { err: e },
                "failed to fetch legacy gasPrices from estimateFeesPerGas"
            )
            gasPrice = undefined
        }

        if (gasPrice === undefined) {
            this.logger.warn("gasPrice is undefined, using fallback value")
            try {
                gasPrice = await this.config.publicClient.getGasPrice()
            } catch (e) {
                this.logger.error("failed to get fallback gasPrice")
                sentry.captureException(e)
                throw e
            }
        }

        return {
            maxFeePerGas: gasPrice,
            maxPriorityFeePerGas: gasPrice
        }
    }

    private async estimateGasPrice(): Promise<GasPriceParameters> {
        let maxFeePerGas: bigint | undefined
        let maxPriorityFeePerGas: bigint | undefined

        const { publicClient, staticMaxPriorityFeePerGas } = this.config

        try {
            let chain: Chain | undefined

            // If staticMaxPriorityFeePerGas is set, use it as a static value instead of RPC estimation.
            if (staticMaxPriorityFeePerGas) {
                chain = {
                    ...publicClient.chain,
                    fees: {
                        ...publicClient.chain.fees,
                        maxPriorityFeePerGas: staticMaxPriorityFeePerGas
                    }
                }
            }

            const fees = await publicClient.estimateFeesPerGas({
                chain
            })

            maxFeePerGas = fees.maxFeePerGas
            maxPriorityFeePerGas = fees.maxPriorityFeePerGas
        } catch (e) {
            sentry.captureException(e)
            this.logger.error(
                { err: e },
                "failed to fetch eip-1559 gasPrices from estimateFeesPerGas"
            )
            maxFeePerGas = undefined
            maxPriorityFeePerGas = undefined
        }

        if (maxPriorityFeePerGas === undefined) {
            this.logger.warn(
                "maxPriorityFeePerGas is undefined, using fallback value"
            )
            try {
                maxPriorityFeePerGas =
                    await this.getFallBackMaxPriorityFeePerGas(
                        publicClient,
                        maxFeePerGas ?? 0n
                    )
            } catch (e) {
                this.logger.error("failed to get fallback maxPriorityFeePerGas")
                sentry.captureException(e)
                throw e
            }
        }

        if (maxFeePerGas === undefined) {
            this.logger.warn("maxFeePerGas is undefined, using fallback value")
            try {
                maxFeePerGas =
                    (await publicClient.getGasPrice()) + maxPriorityFeePerGas
            } catch (e) {
                this.logger.error("failed to get fallback maxFeePerGas")
                sentry.captureException(e)
                throw e
            }
        }

        if (maxPriorityFeePerGas === 0n) {
            maxPriorityFeePerGas = maxFeePerGas / 200n
        }

        return { maxFeePerGas, maxPriorityFeePerGas }
    }

    // Estimates gas price using eth_feeHistory to get previous baseFee/gasUsedRatio/maxPriorityFeePerGas.
    // Selects a priority fee percentile based on average block fullness.
    // When forExecutor is true, computes a worst-case maxFeePerGas for N-block inclusion guarantee.
    // When forExecutor is false, uses baseFee * 1.2 (same as viem default) and avoids setting a too high maxFeePerGas.
    private async estimateDynamicGasPrice({
        forExecutor
    }: {
        forExecutor: boolean
    }): Promise<GasPriceParameters> {
        const {
            publicClient,
            dynamicGasPriceLookbackBlocks,
            dynamicGasPriceTargetInclusionBlocks
        } = this.config

        const blockCount = dynamicGasPriceLookbackBlocks
        const targetInclusionBlocks = dynamicGasPriceTargetInclusionBlocks

        const rewardPercentiles = [40, 50, 60, 70]

        const feeHistory = await publicClient.getFeeHistory({
            blockCount,
            rewardPercentiles,
            blockTag: "latest"
        })

        // Compute average block fullness from gasUsedRatio
        const avgFullness =
            feeHistory.gasUsedRatio.reduce((acc, ratio) => acc + ratio, 0) /
            feeHistory.gasUsedRatio.length

        // Select percentile index based on congestion level
        let percentileIndex: number
        if (avgFullness > 0.9) {
            percentileIndex = 3 // 70th percentile — high congestion
        } else if (avgFullness > 0.7) {
            percentileIndex = 2 // 60th percentile
        } else if (avgFullness > 0.5) {
            percentileIndex = 1 // 50th percentile
        } else {
            percentileIndex = 0 // 40th percentile — low congestion
        }

        // Compute maxPriorityFeePerGas from rewards at selected percentile
        let maxPriorityFeePerGas: bigint
        if (
            feeHistory.reward &&
            feeHistory.reward.length > 0 &&
            feeHistory.reward[0].length > percentileIndex
        ) {
            const rewards = feeHistory.reward
            const sum = rewards.reduce(
                (acc, blockRewards) => acc + blockRewards[percentileIndex],
                0n
            )
            maxPriorityFeePerGas = sum / BigInt(rewards.length)
        } else {
            this.logger.warn(
                "dynamic gas price: reward data missing, using fallback"
            )
            sentry.captureMessage(
                "dynamic gas price: reward data missing, using fallback"
            )
            maxPriorityFeePerGas = await this.getFallBackMaxPriorityFeePerGas(
                publicClient,
                0n
            )
        }

        const baseFees = feeHistory.baseFeePerGas
        const latestBaseFee = baseFees[baseFees.length - 1]

        let maxFeePerGas: bigint

        if (forExecutor) {
            // Compute worst-case baseFee for N-block inclusion guarantee.
            // EIP-1559 formula:
            // base_fee_per_gas_delta = parent_base_fee_per_gas * gas_used_delta // parent_gas_target // BASE_FEE_MAX_CHANGE_DENOMINATOR
            // With BASE_FEE_MAX_CHANGE_DENOMINATOR=8 and ELASTICITY_MULTIPLIER=2,
            // a 100% full block increases base fee by 1/8 = 12.5%.
            // worstCaseBaseFee = currentBaseFee * (1125/1000)^targetInclusionBlocks
            //
            // Reference: https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1559.md?plain=1#L189
            let worstCaseBaseFee = latestBaseFee

            for (let i = 0; i < targetInclusionBlocks; i++) {
                const delta = maxBigInt(worstCaseBaseFee / 8n, 1n)
                worstCaseBaseFee = worstCaseBaseFee + delta
            }

            maxFeePerGas = worstCaseBaseFee + maxPriorityFeePerGas
        } else {
            // For userOp estimation, use baseFee * 1.2 (same as viem default).
            // This avoids returning a overly inflated maxFeePerGas.
            const scaledBaseFee = scaleBigIntByPercent(latestBaseFee, 120n)
            maxFeePerGas = scaledBaseFee + maxPriorityFeePerGas
        }

        return { maxFeePerGas, maxPriorityFeePerGas }
    }

    // This method throws if it can't get a valid RPC response.
    private async innerGetGasPrice({
        forExecutor
    }: {
        forExecutor: boolean
    }): Promise<GasPriceParameters> {
        if (this.config.chainId === polygon.id) {
            const polygonEstimate = await this.getPolygonGasPriceParameters()
            if (polygonEstimate) {
                return this.bumpTheGasPrice(polygonEstimate)
            }
        }

        if (this.config.legacyTransactions) {
            const legacyGasPrice = await this.getLegacyTransactionGasPrice()
            return this.bumpTheGasPrice(legacyGasPrice)
        }

        const estimatedGasPrice = this.config.dynamicGasPrice
            ? await this.estimateDynamicGasPrice({ forExecutor })
            : await this.estimateGasPrice()
        return this.bumpTheGasPrice(estimatedGasPrice)
    }

    // This method throws if it can't get a valid RPC response.
    private async tryUpdateBaseFee(): Promise<bigint> {
        try {
            const latestBlock = await this.config.publicClient.getBlock()
            if (latestBlock.baseFeePerGas === null) {
                throw new RpcError("block does not have baseFeePerGas")
            }

            const baseFee = latestBlock.baseFeePerGas
            this.baseFeePerGasQueue.saveValue(baseFee)

            return baseFee
        } catch (e) {
            this.logger.error(e, "Failed to update base fee")
            sentry.captureException(e)
            throw e
        }
    }

    public async getBaseFee(): Promise<bigint> {
        try {
            if (this.config.legacyTransactions) {
                return 0n
            }

            if (this.config.gasPriceRefreshInterval === 0) {
                return await this.tryUpdateBaseFee()
            }

            let baseFee = await this.baseFeePerGasQueue.getLatestValue()
            if (!baseFee) {
                baseFee = await this.tryUpdateBaseFee()
            }

            return baseFee
        } catch (e) {
            this.logger.error(e, "Failed to get base fee, returning 0n")

            // Save 0n to the queue for the missing baseFee case
            this.baseFeePerGasQueue.saveValue(0n)
            return 0n
        }
    }

    // This method throws if it can't get a valid RPC response.
    private async tryUpdateGasPrice(): Promise<GasPriceParameters> {
        const gasPrice = await this.innerGetGasPrice({
            forExecutor: false
        })

        this.maxFeePerGasQueue.saveValue(gasPrice.maxFeePerGas)
        this.maxPriorityFeePerGasQueue.saveValue(gasPrice.maxPriorityFeePerGas)

        return gasPrice
    }

    public async getGasPrice(): Promise<GasPriceParameters> {
        if (this.config.isGasFreeChain) {
            return {
                maxFeePerGas: 0n,
                maxPriorityFeePerGas: 0n
            }
        }

        if (this.config.gasPriceRefreshInterval === 0) {
            try {
                return await this.tryUpdateGasPrice()
            } catch (e) {
                this.logger.error(e, "No gas price available")
                throw new Error("No gas price available")
            }
        }

        const [maxFeePerGas, maxPriorityFeePerGas] = await Promise.all([
            this.maxFeePerGasQueue.getLatestValue(),
            this.maxPriorityFeePerGasQueue.getLatestValue()
        ])

        if (!maxFeePerGas || !maxPriorityFeePerGas) {
            throw new Error("No gas price available")
        }

        return {
            maxFeePerGas,
            maxPriorityFeePerGas
        }
    }

    // This method throws if it can't get a valid RPC response.
    public async tryGetNetworkGasPrice({
        forExecutor
    }: {
        forExecutor: boolean
    }): Promise<GasPriceParameters> {
        return await this.innerGetGasPrice({ forExecutor })
    }

    public async getMaxBaseFeePerGas(): Promise<bigint> {
        try {
            let maxBaseFeePerGas = await this.baseFeePerGasQueue.getMaxValue()
            if (!maxBaseFeePerGas) {
                maxBaseFeePerGas = await this.getBaseFee()
            }

            return maxBaseFeePerGas
        } catch (e) {
            this.logger.error(
                e,
                "Failed to get max base fee per gas, returning 0n"
            )
            return 0n
        }
    }

    public async getHighestMaxFeePerGas(): Promise<bigint> {
        let highestMaxFeePerGas = await this.maxFeePerGasQueue.getMaxValue()
        if (!highestMaxFeePerGas) {
            const gasPrice = await this.getGasPrice()
            highestMaxFeePerGas = gasPrice.maxFeePerGas
        }

        return highestMaxFeePerGas
    }

    public async getHighestMaxPriorityFeePerGas(): Promise<bigint> {
        let highestMaxPriorityFeePerGas =
            await this.maxPriorityFeePerGasQueue.getMaxValue()
        if (!highestMaxPriorityFeePerGas) {
            const gasPrice = await this.getGasPrice()
            highestMaxPriorityFeePerGas = gasPrice.maxPriorityFeePerGas
        }

        return highestMaxPriorityFeePerGas
    }

    private async getMinMaxFeePerGas(): Promise<bigint> {
        let minMaxFeePerGas = await this.maxFeePerGasQueue.getMinValue()
        if (!minMaxFeePerGas) {
            const gasPrice = await this.getGasPrice()
            minMaxFeePerGas = gasPrice.maxFeePerGas
        }

        return minMaxFeePerGas
    }

    private async getMinMaxPriorityFeePerGas(): Promise<bigint> {
        let minMaxPriorityFeePerGas =
            await this.maxPriorityFeePerGasQueue.getMinValue()

        if (!minMaxPriorityFeePerGas) {
            const gasPrices = await this.getGasPrice()
            minMaxPriorityFeePerGas = gasPrices.maxPriorityFeePerGas
        }

        return minMaxPriorityFeePerGas
    }

    public async getLowestValidGasPrices() {
        let lowestMaxFeePerGas = await this.getMinMaxFeePerGas()
        let lowestMaxPriorityFeePerGas = await this.getMinMaxPriorityFeePerGas()

        if (this.config.chainType === "hedera") {
            lowestMaxFeePerGas /= 10n ** 9n
            lowestMaxPriorityFeePerGas /= 10n ** 9n
        }

        return {
            lowestMaxFeePerGas,
            lowestMaxPriorityFeePerGas
        }
    }
}
