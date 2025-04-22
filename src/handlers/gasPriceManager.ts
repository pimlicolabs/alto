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
                // Ensure that maxFeePerGas is always greater or equal than maxPriorityFeePerGas
                maxFeePerGas: maxBigInt(maxFeePerGas, maxPriorityFeePerGas),
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
        let maxFeePerGas: bigint | undefined
        let maxPriorityFeePerGas: bigint | undefined

        try {
            const fees = await this.config.publicClient.estimateFeesPerGas({
                chain: this.config.publicClient.chain
            })
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
        let maxFeePerGas = 0n
        let maxPriorityFeePerGas = 0n

        if (this.config.chainId === polygon.id) {
            const polygonEstimate = await this.getPolygonGasPriceParameters()
            if (polygonEstimate) {
                const gasPrice = this.bumpTheGasPrice({
                    maxFeePerGas: polygonEstimate.maxFeePerGas,
                    maxPriorityFeePerGas: polygonEstimate.maxPriorityFeePerGas
                })

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
            const gasPrice = this.bumpTheGasPrice(
                await this.getLegacyTransactionGasPrice()
            )
            return {
                maxFeePerGas: maxBigInt(gasPrice.maxFeePerGas, maxFeePerGas),
                maxPriorityFeePerGas: maxBigInt(
                    gasPrice.maxPriorityFeePerGas,
                    maxPriorityFeePerGas
                )
            }
        }

        const estimatedPrice = await this.estimateGasPrice()

        maxFeePerGas = estimatedPrice.maxFeePerGas
        maxPriorityFeePerGas = estimatedPrice.maxPriorityFeePerGas

        const gasPrice = this.bumpTheGasPrice({
            maxFeePerGas,
            maxPriorityFeePerGas
        })
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
        const gasPrice = await this.innerGetGasPrice()

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
                throw new RpcError("No gas price available")
            }
        }

        const [maxFeePerGas, maxPriorityFeePerGas] = await Promise.all([
            this.maxFeePerGasQueue.getLatestValue(),
            this.maxPriorityFeePerGasQueue.getLatestValue()
        ])

        if (!maxFeePerGas || !maxPriorityFeePerGas) {
            throw new RpcError("No gas price available")
        }

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
