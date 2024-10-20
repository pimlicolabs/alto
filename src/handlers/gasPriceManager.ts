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

class ArbitrumManager {
    private l1BaseFeeQueue: TimedQueue
    private l2BaseFeeQueue: TimedQueue

    constructor(maxQueueSize: number) {
        const queueValidity = 15_000
        this.l1BaseFeeQueue = new TimedQueue(maxQueueSize, queueValidity)
        this.l2BaseFeeQueue = new TimedQueue(maxQueueSize, queueValidity)
    }

    public saveL1BaseFee(baseFee: bigint) {
        this.l1BaseFeeQueue.saveValue(baseFee)
    }

    public saveL2BaseFee(baseFee: bigint) {
        this.l2BaseFeeQueue.saveValue(baseFee)
    }

    public getMinL1BaseFee() {
        return this.l1BaseFeeQueue.getMinValue(1n)
    }

    public getMaxL1BaseFee() {
        const maxUint128 = (1n << 128n) - 1n
        return this.l1BaseFeeQueue.getMaxValue(maxUint128)
    }

    public getMaxL2BaseFee() {
        const maxUint128 = (1n << 128n) - 1n
        return this.l2BaseFeeQueue.getMaxValue(maxUint128)
    }
}

class MantleManager {
    private tokenRatioQueue: TimedQueue
    private scalarQueue: TimedQueue
    private rollupDataGasAndOverheadQueue: TimedQueue
    private l1GasPriceQueue: TimedQueue

    constructor(maxQueueSize: number) {
        const queueValidity = 15_000
        this.tokenRatioQueue = new TimedQueue(maxQueueSize, queueValidity)
        this.scalarQueue = new TimedQueue(maxQueueSize, queueValidity)
        this.rollupDataGasAndOverheadQueue = new TimedQueue(
            maxQueueSize,
            queueValidity
        )
        this.l1GasPriceQueue = new TimedQueue(maxQueueSize, queueValidity)
    }

    public getMinMantleOracleValues() {
        return {
            minTokenRatio: this.tokenRatioQueue.getMinValue(1n),
            minScalar: this.scalarQueue.getMinValue(1n),
            minRollupDataGasAndOverhead:
                this.rollupDataGasAndOverheadQueue.getMinValue(1n),
            minL1GasPrice: this.l1GasPriceQueue.getMinValue(1n)
        }
    }

    public saveMantleOracleValues({
        tokenRatio,
        scalar,
        rollupDataGasAndOverhead,
        l1GasPrice
    }: {
        tokenRatio: bigint
        scalar: bigint
        rollupDataGasAndOverhead: bigint
        l1GasPrice: bigint
    }) {
        this.tokenRatioQueue.saveValue(tokenRatio)
        this.scalarQueue.saveValue(scalar)
        this.rollupDataGasAndOverheadQueue.saveValue(rollupDataGasAndOverhead)
        this.l1GasPriceQueue.saveValue(l1GasPrice)
    }
}

class TimedQueue {
    private queue: { timestamp: number; value: bigint }[]
    private maxQueueSize: number
    private queueValidity: number

    constructor(maxQueueSize: number, queueValidity: number) {
        this.queue = []
        this.maxQueueSize = maxQueueSize
        this.queueValidity = queueValidity
    }

    public saveValue(value: bigint) {
        if (value === 0n) {
            return
        }

        const last = this.queue[this.queue.length - 1]
        const timestamp = Date.now()

        if (!last || timestamp - last.timestamp >= this.queueValidity) {
            if (this.queue.length >= this.maxQueueSize) {
                this.queue.shift()
            }
            this.queue.push({ value, timestamp })
        } else if (value < last.value) {
            last.value = value
            last.timestamp = timestamp
        }
    }

    public getLatestValue(): bigint | null {
        if (this.queue.length === 0) {
            return null
        }
        return this.queue[this.queue.length - 1].value
    }

    public getMinValue(defaultValue: bigint) {
        if (this.queue.length === 0) {
            return defaultValue
        }
        return this.queue.reduce(
            (acc, cur) => (cur.value < acc ? cur.value : acc),
            this.queue[0].value
        )
    }

    public getMaxValue(defaultValue: bigint) {
        if (this.queue.length === 0) {
            return defaultValue
        }
        return this.queue.reduce(
            (acc, cur) => (cur.value > acc ? cur.value : acc),
            this.queue[0].value
        )
    }

    public isEmpty(): boolean {
        return this.queue.length === 0
    }
}

export class GasPriceManager {
    private readonly config: AltoConfig
    private baseFeePerGasQueue: TimedQueue
    private maxFeePerGasQueue: TimedQueue
    private maxPriorityFeePerGasQueue: TimedQueue
    public arbitrumManager: ArbitrumManager
    public mantleManager: MantleManager
    private maxQueueSize: number
    private logger: Logger

    constructor(config: AltoConfig) {
        this.config = config
        this.logger = config.getLogger(
            { module: "gas_price_manager" },
            {
                level: config.publicClientLogLevel || config.logLevel
            }
        )
        this.maxQueueSize = this.config.gasPriceExpiry

        const queueValidity = 1000 // milliseconds
        this.baseFeePerGasQueue = new TimedQueue(
            this.maxQueueSize,
            queueValidity
        )
        this.maxFeePerGasQueue = new TimedQueue(
            this.maxQueueSize,
            queueValidity
        )
        this.maxPriorityFeePerGasQueue = new TimedQueue(
            this.maxQueueSize,
            queueValidity
        )

        // Periodically update gas prices if specified
        if (this.config.gasPriceRefreshInterval > 0) {
            setInterval(() => {
                if (this.config.legacyTransactions === false) {
                    this.updateBaseFee()
                }

                this.updateGasPrice()
            }, this.config.gasPriceRefreshInterval * 1000)
        }

        this.arbitrumManager = new ArbitrumManager(this.maxQueueSize)
        this.mantleManager = new MantleManager(this.maxQueueSize)
    }

    public init() {
        return Promise.all([
            this.updateGasPrice(),
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

    private async getNextBaseFee(publicClient: PublicClient) {
        const block = await publicClient.getBlock({
            blockTag: "latest"
        })
        const currentBaseFeePerGas =
            block.baseFeePerGas || (await publicClient.getGasPrice())
        const currentGasUsed = block.gasUsed
        const gasTarget = block.gasLimit / 2n

        if (currentGasUsed === gasTarget) {
            return currentBaseFeePerGas
        }

        if (currentGasUsed > gasTarget) {
            const gasUsedDelta = currentGasUsed - gasTarget
            const baseFeePerGasDelta = maxBigInt(
                (currentBaseFeePerGas * gasUsedDelta) / gasTarget / 8n,
                1n
            )
            return currentBaseFeePerGas + baseFeePerGasDelta
        }

        const gasUsedDelta = currentGasUsed - gasTarget
        const baseFeePerGasDelta =
            (currentBaseFeePerGas * gasUsedDelta) / gasTarget / 8n
        return currentBaseFeePerGas - baseFeePerGasDelta
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
                    (await this.getNextBaseFee(this.config.publicClient)) +
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

        const baseFee = this.baseFeePerGasQueue.getLatestValue()
        if (baseFee === null) {
            throw new RpcError("No base fee available")
        }

        return baseFee
    }

    private async updateGasPrice(): Promise<GasPriceParameters> {
        const gasPrice = await this.innerGetGasPrice()

        this.maxFeePerGasQueue.saveValue(gasPrice.maxFeePerGas)
        this.maxPriorityFeePerGasQueue.saveValue(gasPrice.maxPriorityFeePerGas)

        return gasPrice
    }

    public async getGasPrice(): Promise<GasPriceParameters> {
        if (this.config.gasPriceRefreshInterval === 0) {
            return await this.updateGasPrice()
        }

        const maxFeePerGas = this.maxFeePerGasQueue.getLatestValue()
        const maxPriorityFeePerGas =
            this.maxPriorityFeePerGasQueue.getLatestValue()

        if (maxFeePerGas === null || maxPriorityFeePerGas === null) {
            throw new RpcError("No gas price available")
        }

        return {
            maxFeePerGas,
            maxPriorityFeePerGas
        }
    }

    public async getMaxBaseFeePerGas(): Promise<bigint> {
        if (this.baseFeePerGasQueue.isEmpty()) {
            await this.getBaseFee()
        }

        return this.baseFeePerGasQueue.getMaxValue(0n)
    }

    private async getMinMaxFeePerGas(): Promise<bigint> {
        if (this.maxFeePerGasQueue.isEmpty()) {
            await this.getGasPrice()
        }

        return this.maxFeePerGasQueue.getMinValue(0n)
    }

    private async getMinMaxPriorityFeePerGas(): Promise<bigint> {
        if (this.maxPriorityFeePerGasQueue.isEmpty()) {
            await this.getGasPrice()
        }

        return this.maxPriorityFeePerGasQueue.getMinValue(0n)
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
