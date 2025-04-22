import {
    type GasPriceParameters,
    RpcError,
    gasStationResult
} from "@alto/types"
import { type Logger, maxBigInt, minBigInt } from "@alto/utils"
import * as sentry from "@sentry/node"
import { type PublicClient, parseGwei } from "viem"
import { polygon } from "viem/chains"
import type { AltoConfig } from "../createConfig"
import { MinMaxQueue, createMinMaxQueue } from "../utils/minMaxQueue"
import { ArbitrumManager } from "./arbitrumGasPriceManager"
import { MantleManager } from "./mantleGasPriceManager"
import { OptimismManager } from "./optimismManager"

export class GasPriceManager {
    private readonly config: AltoConfig
    private baseFeePerGasQueue: MinMaxQueue
    private maxFeePerGasQueue: MinMaxQueue
    private maxPriorityFeePerGasQueue: MinMaxQueue
    private logger: Logger

    public arbitrumManager: ArbitrumManager
    public mantleManager: MantleManager
    public optimismManager: OptimismManager

    constructor(config: AltoConfig) {
        this.config = config
        this.logger = config.getLogger(
            { module: "gas_price_manager" },
            {
                level: config.publicClientLogLevel || config.logLevel
            }
        )

        this.baseFeePerGasQueue = createMinMaxQueue({
            config,
            keyPrefix: "base-fee-per-gas-queue"
        })
        this.maxFeePerGasQueue = createMinMaxQueue({
            config,
            keyPrefix: "max-fee-per-gas-queue"
        })
        this.maxPriorityFeePerGasQueue = createMinMaxQueue({
            config,
            keyPrefix: "max-priority-fee-per-gas-queue"
        })

        // Periodically update gas prices if specified
        if (this.config.gasPriceRefreshInterval > 0) {
            setInterval(() => {
                try {
                    if (this.config.legacyTransactions === false) {
                        this.updateBaseFee()
                    }

                    this.tryUpdateGasPrice()
                } catch (error) {
                    this.logger.error(
                        { error },
                        "Error updating gas prices in interval"
                    )
                    sentry.captureException(error)
                }
            }, this.config.gasPriceRefreshInterval * 1000)
        }

        this.arbitrumManager = new ArbitrumManager({ config })
        this.mantleManager = new MantleManager({ config })
        this.optimismManager = new OptimismManager({ config })
    }

    public async init() {
        try {
            await Promise.all([
                this.tryUpdateGasPrice(),
                this.config.legacyTransactions === false
                    ? this.updateBaseFee()
                    : Promise.resolve()
            ])
        } catch (error) {
            this.logger.error(error, "Error during gas price initialization")
        }
    }

    private getDefaultGasFee(chainId: number): bigint {
        switch (chainId) {
            case polygon.id:
                return parseGwei("31")
            default:
                return 0n
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
                { error: e },
                "failed to get gas price from gas station, using default"
            )
            return null
        }
    }

    private bumpTheGasPrice(
        gasPriceParameters: GasPriceParameters
    ): GasPriceParameters {
        const bumpAmount = this.config.gasPriceBump

        const maxPriorityFeePerGas = maxBigInt(
            gasPriceParameters.maxPriorityFeePerGas,
            this.getDefaultGasFee(this.config.chainId)
        )
        const maxFeePerGas = maxBigInt(
            gasPriceParameters.maxFeePerGas,
            maxPriorityFeePerGas
        )

        const result = {
            maxFeePerGas: (maxFeePerGas * bumpAmount) / 100n,
            maxPriorityFeePerGas: (maxPriorityFeePerGas * bumpAmount) / 100n
        }

        if (
            this.config.floorMaxFeePerGas ||
            this.config.floorMaxPriorityFeePerGas
        ) {
            const maxFeePerGas = this.config.floorMaxFeePerGas
                ? maxBigInt(this.config.floorMaxFeePerGas, result.maxFeePerGas)
                : result.maxFeePerGas

            const maxPriorityFeePerGas = this.config.floorMaxPriorityFeePerGas
                ? maxBigInt(
                      this.config.floorMaxPriorityFeePerGas,
                      result.maxPriorityFeePerGas
                  )
                : result.maxPriorityFeePerGas

            return {
                maxFeePerGas,
                maxPriorityFeePerGas
            }
        }

        return result
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
                "failed to fetch legacy gasPrices from estimateFeesPerGas",
                { error: e }
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
        this.logger.info(
            `[LATENCY] STEP 5.3.2.1.1.1.9.1: estimateGasPrice method started`
        )

        let maxFeePerGas: bigint | undefined
        let maxPriorityFeePerGas: bigint | undefined

        try {
            const rpcCallStart = performance.now()
            this.logger.info(
                `[LATENCY] STEP 5.3.2.1.1.1.9.2: Starting RPC call to estimateFeesPerGas`
            )

            const fees = await this.config.publicClient.estimateFeesPerGas({
                chain: this.config.publicClient.chain
            })

            const rpcCallEnd = performance.now()
            this.logger.info(
                `[LATENCY] STEP 5.3.2.1.1.1.9.3: RPC call to estimateFeesPerGas completed: ${
                    rpcCallEnd - rpcCallStart
                }ms`
            )

            maxFeePerGas = fees.maxFeePerGas
            maxPriorityFeePerGas = fees.maxPriorityFeePerGas
        } catch (e) {
            sentry.captureException(e)
            this.logger.error(
                "failed to fetch eip-1559 gasPrices from estimateFeesPerGas",
                { error: e }
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
                        this.config.publicClient,
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
                    (await this.config.publicClient.getGasPrice()) +
                    maxPriorityFeePerGas
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

    // This method throws if it can't get a valid RPC response.
    private async innerGetGasPrice(): Promise<GasPriceParameters> {
        this.logger.info(
            `[LATENCY] STEP 5.3.2.1.1.1.1: innerGetGasPrice method started`
        )

        let maxFeePerGas = 0n
        let maxPriorityFeePerGas = 0n

        if (this.config.chainId === polygon.id) {
            this.logger.info(
                `[LATENCY] STEP 5.3.2.1.1.1.2: Using Polygon gas price API`
            )
            const polygonStart = performance.now()
            const polygonEstimate = await this.getPolygonGasPriceParameters()
            const polygonEnd = performance.now()
            this.logger.info(
                `[LATENCY] STEP 5.3.2.1.1.1.3: Polygon gas price fetch completed: ${
                    polygonEnd - polygonStart
                }ms`
            )

            if (polygonEstimate) {
                const bumpStart = performance.now()
                const gasPrice = this.bumpTheGasPrice({
                    maxFeePerGas: polygonEstimate.maxFeePerGas,
                    maxPriorityFeePerGas: polygonEstimate.maxPriorityFeePerGas
                })
                const bumpEnd = performance.now()
                this.logger.info(
                    `[LATENCY] STEP 5.3.2.1.1.1.4: Gas price bumping completed: ${
                        bumpEnd - bumpStart
                    }ms`
                )

                return {
                    maxFeePerGas: maxBigInt(
                        gasPrice.maxFeePerGas,
                        maxFeePerGas
                    ),
                    maxPriorityFeePerGas: maxBigInt(
                        gasPrice.maxPriorityFeePerGas,
                        maxPriorityFeePerGas
                    )
                }
            }
        }

        if (this.config.legacyTransactions) {
            this.logger.info(
                `[LATENCY] STEP 5.3.2.1.1.1.5: Using legacy transactions gas price`
            )
            const legacyStart = performance.now()
            const legacyGasPrice = await this.getLegacyTransactionGasPrice()
            const legacyEnd = performance.now()
            this.logger.info(
                `[LATENCY] STEP 5.3.2.1.1.1.6: Legacy gas price fetch completed: ${
                    legacyEnd - legacyStart
                }ms`
            )

            const bumpStart = performance.now()
            const gasPrice = this.bumpTheGasPrice(legacyGasPrice)
            const bumpEnd = performance.now()
            this.logger.info(
                `[LATENCY] STEP 5.3.2.1.1.1.7: Legacy gas price bumping completed: ${
                    bumpEnd - bumpStart
                }ms`
            )

            return {
                maxFeePerGas: maxBigInt(gasPrice.maxFeePerGas, maxFeePerGas),
                maxPriorityFeePerGas: maxBigInt(
                    gasPrice.maxPriorityFeePerGas,
                    maxPriorityFeePerGas
                )
            }
        }

        this.logger.info(
            `[LATENCY] STEP 5.3.2.1.1.1.8: Using EIP-1559 gas price estimation`
        )
        const estimateStart = performance.now()
        const estimatedPrice = await this.estimateGasPrice()
        const estimateEnd = performance.now()
        this.logger.info(
            `[LATENCY] STEP 5.3.2.1.1.1.9: EIP-1559 gas price estimation completed: ${
                estimateEnd - estimateStart
            }ms`
        )

        maxFeePerGas = estimatedPrice.maxFeePerGas
        maxPriorityFeePerGas = estimatedPrice.maxPriorityFeePerGas

        const bumpStart = performance.now()
        const gasPrice = this.bumpTheGasPrice({
            maxFeePerGas,
            maxPriorityFeePerGas
        })
        const bumpEnd = performance.now()
        this.logger.info(
            `[LATENCY] STEP 5.3.2.1.1.1.10: EIP-1559 gas price bumping completed: ${
                bumpEnd - bumpStart
            }ms`
        )
        return {
            maxFeePerGas: maxBigInt(gasPrice.maxFeePerGas, maxFeePerGas),
            maxPriorityFeePerGas: maxBigInt(
                gasPrice.maxPriorityFeePerGas,
                maxPriorityFeePerGas
            )
        }
    }

    private async updateBaseFee(): Promise<bigint> {
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
            throw e
        }
    }

    public async getBaseFee(): Promise<bigint> {
        try {
            if (this.config.legacyTransactions) {
                throw new RpcError(
                    "baseFee is not available for legacy transactions"
                )
            }

            if (this.config.gasPriceRefreshInterval === 0) {
                return await this.updateBaseFee()
            }

            let baseFee = await this.baseFeePerGasQueue.getLatestValue()
            if (!baseFee) {
                baseFee = await this.updateBaseFee()
            }

            return baseFee
        } catch (e) {
            this.logger.error(e, "Failed to get base fee")
            throw new RpcError("Failed to get base fee")
        }
    }

    // This method throws if it can't get a valid RPC response.
    private async tryUpdateGasPrice(): Promise<GasPriceParameters> {
        const startTime = performance.now()
        this.logger.info(
            `[LATENCY] STEP 5.3.2.1.1.1: innerGetGasPrice starting`
        )

        const gasPrice = await this.innerGetGasPrice()

        const gasPriceTime = performance.now()
        this.logger.info(
            `[LATENCY] STEP 5.3.2.1.1.2: innerGetGasPrice completed: ${
                gasPriceTime - startTime
            }ms`
        )

        const saveStart = performance.now()
        await this.maxFeePerGasQueue.saveValue(gasPrice.maxFeePerGas)
        const saveFeeTime = performance.now()
        this.logger.info(
            `[LATENCY] STEP 5.3.2.1.1.3: maxFeePerGasQueue.saveValue time: ${
                saveFeeTime - saveStart
            }ms`
        )

        await this.maxPriorityFeePerGasQueue.saveValue(
            gasPrice.maxPriorityFeePerGas
        )
        const savePriorityTime = performance.now()
        this.logger.info(
            `[LATENCY] STEP 5.3.2.1.1.4: maxPriorityFeePerGasQueue.saveValue time: ${
                savePriorityTime - saveFeeTime
            }ms`
        )

        const endTime = performance.now()
        this.logger.info(
            `[LATENCY] STEP 5.3.2.1.1.5: tryUpdateGasPrice total time: ${
                endTime - startTime
            }ms`
        )
        return gasPrice
    }

    public async getGasPrice(): Promise<GasPriceParameters> {
        const gasPriceStartTime = performance.now()
        this.logger.info("[LATENCY] STEP 5.3.2.1: getGasPrice method started")

        if (this.config.isGasFreeChain) {
            const endTime = performance.now()
            this.logger.info(
                `[LATENCY] getGasPrice early return (gas free chain): ${
                    endTime - gasPriceStartTime
                }ms`
            )
            return {
                maxFeePerGas: 0n,
                maxPriorityFeePerGas: 0n
            }
        }

        if (this.config.gasPriceRefreshInterval === 0) {
            try {
                const updateStartTime = performance.now()

                // Capture RPC call times
                const rpcCallStart = performance.now()
                this.logger.info(
                    `[LATENCY] STEP 5.3.2.1.1: Starting RPC call for gas price`
                )

                const result = await this.tryUpdateGasPrice()

                const rpcCallEnd = performance.now()
                this.logger.info(
                    `[LATENCY] STEP 5.3.2.1.2: RPC call for gas price completed: ${
                        rpcCallEnd - rpcCallStart
                    }ms`
                )

                const endTime = performance.now()
                this.logger.info(
                    `[LATENCY] STEP 5.3.2.1.3: tryUpdateGasPrice completed: ${
                        endTime - updateStartTime
                    }ms`
                )
                this.logger.info(
                    `[LATENCY] STEP 5.3.2.4: getGasPrice total time: ${
                        endTime - gasPriceStartTime
                    }ms`
                )
                return result
            } catch (e) {
                const endTime = performance.now()
                this.logger.error(
                    e,
                    `[LATENCY] getGasPrice error after: ${
                        endTime - gasPriceStartTime
                    }ms`
                )
                throw new RpcError("No gas price available")
            }
        }

        const queueStartTime = performance.now()
        this.logger.info(
            "[LATENCY] STEP 5.3.2.2: Starting queue value retrieval"
        )

        // Track timing of each queue operation separately
        const maxFeeStart = performance.now()
        const maxFeePerGas = await this.maxFeePerGasQueue.getLatestValue()
        const maxFeeEnd = performance.now()
        this.logger.info(
            `[LATENCY] STEP 5.3.2.2.1: maxFeePerGasQueue.getLatestValue time: ${
                maxFeeEnd - maxFeeStart
            }ms`
        )

        const maxPriorityFeeStart = performance.now()
        const maxPriorityFeePerGas =
            await this.maxPriorityFeePerGasQueue.getLatestValue()
        const maxPriorityFeeEnd = performance.now()
        this.logger.info(
            `[LATENCY] STEP 5.3.2.2.2: maxPriorityFeePerGasQueue.getLatestValue time: ${
                maxPriorityFeeEnd - maxPriorityFeeStart
            }ms`
        )

        const queueEndTime = performance.now()
        this.logger.info(
            `[LATENCY] STEP 5.3.2.3: Queue value retrieval completed: ${
                queueEndTime - queueStartTime
            }ms`
        )

        if (!maxFeePerGas || !maxPriorityFeePerGas) {
            const endTime = performance.now()
            this.logger.error(
                `[LATENCY] getGasPrice error (missing values) after: ${
                    endTime - gasPriceStartTime
                }ms`
            )
            throw new RpcError("No gas price available")
        }

        const endTime = performance.now()
        this.logger.info(
            `[LATENCY] STEP 5.3.2.4: getGasPrice total time: ${
                endTime - gasPriceStartTime
            }ms`
        )

        return {
            maxFeePerGas,
            maxPriorityFeePerGas
        }
    }

    // This method throws if it can't get a valid RPC response.
    public async tryGetNetworkGasPrice(): Promise<GasPriceParameters> {
        return await this.innerGetGasPrice()
    }

    public async getMaxBaseFeePerGas(): Promise<bigint> {
        let maxBaseFeePerGas = await this.baseFeePerGasQueue.getMaxValue()
        if (!maxBaseFeePerGas) {
            maxBaseFeePerGas = await this.getBaseFee()
        }

        return maxBaseFeePerGas
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

    public async validateGasPrice(gasPrice: GasPriceParameters) {
        let lowestMaxFeePerGas = await this.getMinMaxFeePerGas()
        let lowestMaxPriorityFeePerGas = await this.getMinMaxPriorityFeePerGas()

        if (this.config.chainType === "hedera") {
            lowestMaxFeePerGas /= 10n ** 9n
            lowestMaxPriorityFeePerGas /= 10n ** 9n
        }

        if (gasPrice.maxFeePerGas < lowestMaxFeePerGas) {
            throw new RpcError(
                `maxFeePerGas must be at least ${lowestMaxFeePerGas} (current maxFeePerGas: ${gasPrice.maxFeePerGas}) - use pimlico_getUserOperationGasPrice to get the current gas price`
            )
        }

        if (gasPrice.maxPriorityFeePerGas < lowestMaxPriorityFeePerGas) {
            throw new RpcError(
                `maxPriorityFeePerGas must be at least ${lowestMaxPriorityFeePerGas} (current maxPriorityFeePerGas: ${gasPrice.maxPriorityFeePerGas}) - use pimlico_getUserOperationGasPrice to get the current gas price`
            )
        }
    }
}
