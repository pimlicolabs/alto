import {
    type GasPriceParameters,
    RpcError,
    gasStationResult
} from "@alto/types"
import { type Logger, maxBigInt, minBigInt } from "@alto/utils"
import * as sentry from "@sentry/node"
import { type PublicClient, parseGwei } from "viem"
import {
    avalanche,
    celo,
    celoAlfajores,
    dfk,
    polygon,
    polygonMumbai
} from "viem/chains"
import type { AltoConfig } from "../createConfig"
import { SlidingWindowTimedQueue } from "../utils/slidingWindowTimedQueue"
import { ArbitrumManager } from "./arbitrumGasPriceManager"
import { MantleManager } from "./mantleGasPriceManager"
import { OptimismManager } from "./optimismManager"

enum ChainId {
    Goerli = 5,
    Polygon = 137,
    Mumbai = 80001,
    LineaTestnet = 59140,
    Linea = 59144
}

const MIN_POLYGON_GAS_PRICE = parseGwei("31")
const MIN_MUMBAI_GAS_PRICE = parseGwei("1")

function getGasStationUrl(chainId: ChainId.Polygon | ChainId.Mumbai): string {
    switch (chainId) {
        case ChainId.Polygon:
            return "https://gasstation.polygon.technology/v2"
        case ChainId.Mumbai:
            return "https://gasstation-testnet.polygon.technology/v2"
    }
}

export class GasPriceManager {
    private readonly config: AltoConfig
    private baseFeePerGasQueue: SlidingWindowTimedQueue
    private maxFeePerGasQueue: SlidingWindowTimedQueue
    private maxPriorityFeePerGasQueue: SlidingWindowTimedQueue
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

        const queueValidity = this.config.gasPriceExpiry * 1_000

        this.baseFeePerGasQueue = new SlidingWindowTimedQueue(queueValidity)
        this.maxFeePerGasQueue = new SlidingWindowTimedQueue(queueValidity)
        this.maxPriorityFeePerGasQueue = new SlidingWindowTimedQueue(
            queueValidity
        )

        // Periodically update gas prices if specified
        if (this.config.gasPriceRefreshInterval > 0) {
            setInterval(() => {
                if (this.config.legacyTransactions === false) {
                    this.updateBaseFee()
                }

                this.tryUpdateGasPrice()
            }, this.config.gasPriceRefreshInterval * 1000)
        }

        this.arbitrumManager = new ArbitrumManager(queueValidity)
        this.mantleManager = new MantleManager(queueValidity)
        this.optimismManager = new OptimismManager(queueValidity)
    }

    public init() {
        return Promise.all([
            this.tryUpdateGasPrice(),
            this.config.legacyTransactions === false
                ? this.updateBaseFee()
                : Promise.resolve()
        ])
    }

    private getDefaultGasFee(
        chainId: ChainId.Polygon | ChainId.Mumbai
    ): bigint {
        switch (chainId) {
            case ChainId.Polygon:
                return MIN_POLYGON_GAS_PRICE
            case ChainId.Mumbai:
                return MIN_MUMBAI_GAS_PRICE
            default:
                return 0n
        }
    }

    private async getPolygonGasPriceParameters(): Promise<GasPriceParameters | null> {
        const gasStationUrl = getGasStationUrl(
            this.config.publicClient.chain.id
        )
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
            this.getDefaultGasFee(this.config.publicClient.chain.id)
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
            this.config.publicClient.chain.id === celo.id ||
            this.config.publicClient.chain.id === celoAlfajores.id
        ) {
            const maxFee = maxBigInt(
                result.maxFeePerGas,
                result.maxPriorityFeePerGas
            )
            return {
                maxFeePerGas: maxFee,
                maxPriorityFeePerGas: maxFee
            }
        }

        if (this.config.publicClient.chain.id === dfk.id) {
            const maxFeePerGas = maxBigInt(5_000_000_000n, result.maxFeePerGas)
            const maxPriorityFeePerGas = maxBigInt(
                5_000_000_000n,
                result.maxPriorityFeePerGas
            )

            return {
                maxFeePerGas,
                maxPriorityFeePerGas
            }
        }

        // set a minimum maxPriorityFee & maxFee to 1.5gwei on avalanche (because eth_maxPriorityFeePerGas returns 0)
        if (this.config.publicClient.chain.id === avalanche.id) {
            const maxFeePerGas = maxBigInt(
                parseGwei("1.5"),
                result.maxFeePerGas
            )
            const maxPriorityFeePerGas = maxBigInt(
                parseGwei("1.5"),
                result.maxPriorityFeePerGas
            )

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

        if (
            this.config.publicClient.chain.id === polygon.id ||
            this.config.publicClient.chain.id === polygonMumbai.id
        ) {
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
        const latestBlock = await this.config.publicClient.getBlock()
        if (latestBlock.baseFeePerGas === null) {
            throw new RpcError("block does not have baseFeePerGas")
        }

        const baseFee = latestBlock.baseFeePerGas
        this.baseFeePerGasQueue.saveValue(baseFee)

        return baseFee
    }

    public async getBaseFee(): Promise<bigint> {
        if (this.config.legacyTransactions) {
            throw new RpcError(
                "baseFee is not available for legacy transactions"
            )
        }

        if (this.config.gasPriceRefreshInterval === 0) {
            return await this.updateBaseFee()
        }

        let baseFee = this.baseFeePerGasQueue.getLatestValue()
        if (!baseFee) {
            baseFee = await this.updateBaseFee()
        }

        return baseFee
    }

    // This method throws if it can't get a valid RPC response.
    private async tryUpdateGasPrice(): Promise<GasPriceParameters> {
        const gasPrice = await this.innerGetGasPrice()

        this.maxFeePerGasQueue.saveValue(gasPrice.maxFeePerGas)
        this.maxPriorityFeePerGasQueue.saveValue(gasPrice.maxPriorityFeePerGas)

        return gasPrice
    }

    public async getGasPrice(): Promise<GasPriceParameters> {
        if (this.config.gasPriceRefreshInterval === 0) {
            return await this.tryUpdateGasPrice()
        }

        const maxFeePerGas = this.maxFeePerGasQueue.getLatestValue()
        const maxPriorityFeePerGas =
            this.maxPriorityFeePerGasQueue.getLatestValue()

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
        let maxBaseFeePerGas = this.baseFeePerGasQueue.getMaxValue()
        if (!maxBaseFeePerGas) {
            maxBaseFeePerGas = await this.getBaseFee()
        }

        return maxBaseFeePerGas
    }

    public async getHighestMaxFeePerGas(): Promise<bigint> {
        let highestMaxFeePerGas = this.maxFeePerGasQueue.getMaxValue()
        if (!highestMaxFeePerGas) {
            const gasPrice = await this.getGasPrice()
            highestMaxFeePerGas = gasPrice.maxFeePerGas
        }

        return highestMaxFeePerGas
    }

    public async getHighestMaxPriorityFeePerGas(): Promise<bigint> {
        let highestMaxPriorityFeePerGas =
            this.maxPriorityFeePerGasQueue.getMaxValue()
        if (!highestMaxPriorityFeePerGas) {
            const gasPrice = await this.getGasPrice()
            highestMaxPriorityFeePerGas = gasPrice.maxPriorityFeePerGas
        }

        return highestMaxPriorityFeePerGas
    }

    private async getMinMaxFeePerGas(): Promise<bigint> {
        let minMaxFeePerGas = this.maxFeePerGasQueue.getMinValue()
        if (!minMaxFeePerGas) {
            const gasPrice = await this.getGasPrice()
            minMaxFeePerGas = gasPrice.maxFeePerGas
        }

        return minMaxFeePerGas
    }

    private async getMinMaxPriorityFeePerGas(): Promise<bigint> {
        let minMaxPriorityFeePerGas =
            this.maxPriorityFeePerGasQueue.getMinValue()

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
