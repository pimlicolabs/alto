import {
    type GasPriceParameters,
    RpcError,
    gasStationResult
} from "@alto/types"
import { type Logger, maxBigInt, minBigInt } from "@alto/utils"
import * as sentry from "@sentry/node"
import { type PublicClient, maxUint128, parseGwei } from "viem"
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
    private queueL1BaseFee: { timestamp: number; baseFee: bigint }[]
    private queueL2BaseFee: { timestamp: number; baseFee: bigint }[]

    private maxQueueSize
    private queueValidity = 15_000

    constructor(maxQueueSize: number) {
        this.maxQueueSize = maxQueueSize
        this.queueL1BaseFee = []
        this.queueL2BaseFee = []
    }

    public saveL1BaseFee(baseFee: bigint) {
        if (baseFee === 0n) {
            return
        }

        const queue = this.queueL1BaseFee
        const last = queue.length > 0 ? queue[queue.length - 1] : null
        const timestamp = Date.now()

        if (!last || timestamp - last.timestamp >= this.queueValidity) {
            if (queue.length >= this.maxQueueSize) {
                queue.shift()
            }
            queue.push({ baseFee, timestamp })
        } else if (baseFee < last.baseFee) {
            last.baseFee = baseFee
            last.timestamp = timestamp
        }
    }

    public saveL2BaseFee(baseFee: bigint) {
        if (baseFee === 0n) {
            return
        }

        const queue = this.queueL2BaseFee
        const last = queue.length > 0 ? queue[queue.length - 1] : null
        const timestamp = Date.now()

        if (!last || timestamp - last.timestamp >= this.queueValidity) {
            if (queue.length >= this.maxQueueSize) {
                queue.shift()
            }
            queue.push({ baseFee, timestamp })
        } else if (baseFee < last.baseFee) {
            last.baseFee = baseFee
            last.timestamp = timestamp
        }
    }

    public async getMinL1BaseFee() {
        const queue = this.queueL1BaseFee

        if (queue.length === 0) {
            return 1n
        }
        return queue.reduce(
            (acc: bigint, cur) => minBigInt(cur.baseFee, acc),
            queue[0].baseFee
        )
    }

    public async getMaxL1BaseFee() {
        const queue = this.queueL1BaseFee

        if (queue.length === 0) {
            return maxUint128
        }

        return queue.reduce(
            (acc: bigint, cur) => maxBigInt(cur.baseFee, acc),
            queue[0].baseFee
        )
    }

    public async getMaxL2BaseFee() {
        const queue = this.queueL2BaseFee

        if (queue.length === 0) {
            return maxUint128
        }

        return queue.reduce(
            (acc: bigint, cur) => maxBigInt(cur.baseFee, acc),
            queue[0].baseFee
        )
    }
}

export class GasPriceManager {
    private readonly config: AltoConfig
    private queueBaseFeePerGas: { timestamp: number; baseFeePerGas: bigint }[] =
        [] // Store pairs of [price, timestamp]
    private queueMaxFeePerGas: { timestamp: number; maxFeePerGas: bigint }[] =
        [] // Store pairs of [price, timestamp]
    private queueMaxPriorityFeePerGas: {
        timestamp: number
        maxPriorityFeePerGas: bigint
    }[] = [] // Store pairs of [price, timestamp]
    public arbitrumManager: ArbitrumManager
    private maxQueueSize: number
    private logger: Logger

    constructor(config: AltoConfig) {
        this.config = config
        this.logger = config.logger.child(
            { module: "gas_price_manager" },
            {
                level: config.publicClientLogLevel || config.logLevel
            }
        )
        this.maxQueueSize = this.config.gasPriceExpiry

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

    private saveBaseFeePerGas(gasPrice: bigint, timestamp: number) {
        const queue = this.queueBaseFeePerGas
        const last = queue.length > 0 ? queue[queue.length - 1] : null

        if (!last || timestamp - last.timestamp >= 1000) {
            if (queue.length >= this.maxQueueSize) {
                queue.shift()
            }
            queue.push({ baseFeePerGas: gasPrice, timestamp })
        } else if (gasPrice < last.baseFeePerGas) {
            last.baseFeePerGas = gasPrice
            last.timestamp = timestamp
        }
    }

    private saveMaxFeePerGas(gasPrice: bigint, timestamp: number) {
        const queue = this.queueMaxFeePerGas
        const last = queue.length > 0 ? queue[queue.length - 1] : null

        if (!last || timestamp - last.timestamp >= 1000) {
            if (queue.length >= this.maxQueueSize) {
                queue.shift()
            }
            queue.push({ maxFeePerGas: gasPrice, timestamp })
        } else if (gasPrice < last.maxFeePerGas) {
            last.maxFeePerGas = gasPrice
            last.timestamp = timestamp
        }
    }

    private saveMaxPriorityFeePerGas(gasPrice: bigint, timestamp: number) {
        const queue = this.queueMaxPriorityFeePerGas
        const last = queue.length > 0 ? queue[queue.length - 1] : null

        if (!last || timestamp - last.timestamp >= 1000) {
            if (queue.length >= this.maxQueueSize) {
                queue.shift()
            }
            queue.push({ maxPriorityFeePerGas: gasPrice, timestamp })
        } else if (gasPrice < last.maxPriorityFeePerGas) {
            last.maxPriorityFeePerGas = gasPrice
            last.timestamp = timestamp
        }
    }

    private saveGasPrice(gasPrice: GasPriceParameters, timestamp: number) {
        return new Promise<void>((resolve) => {
            this.saveMaxFeePerGas(gasPrice.maxFeePerGas, timestamp)
            this.saveMaxPriorityFeePerGas(
                gasPrice.maxPriorityFeePerGas,
                timestamp
            )
            resolve()
        })
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
        this.saveBaseFeePerGas(baseFee, Date.now())

        return baseFee
    }

    public getBaseFee() {
        if (this.config.legacyTransactions) {
            throw new RpcError(
                "baseFee is not available for legacy transactions"
            )
        }

        if (this.config.gasPriceRefreshInterval === 0) {
            return this.updateBaseFee()
        }

        const { baseFeePerGas } =
            this.queueBaseFeePerGas[this.queueBaseFeePerGas.length - 1]

        return baseFeePerGas
    }

    private async updateGasPrice(): Promise<GasPriceParameters> {
        const gasPrice = await this.innerGetGasPrice()

        this.saveGasPrice(
            {
                maxFeePerGas: gasPrice.maxFeePerGas,
                maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas
            },
            Date.now()
        )

        return gasPrice
    }

    public getGasPrice() {
        if (this.config.gasPriceRefreshInterval === 0) {
            return this.updateGasPrice()
        }

        const { maxPriorityFeePerGas } =
            this.queueMaxPriorityFeePerGas[
                this.queueMaxPriorityFeePerGas.length - 1
            ]

        const { maxFeePerGas } =
            this.queueMaxFeePerGas[this.queueMaxFeePerGas.length - 1]

        return {
            maxFeePerGas,
            maxPriorityFeePerGas
        }
    }

    public async getMaxBaseFeePerGas() {
        if (this.queueBaseFeePerGas.length === 0) {
            await this.getBaseFee()
        }

        return this.queueBaseFeePerGas.reduce(
            (acc: bigint, cur) => maxBigInt(cur.baseFeePerGas, acc),
            this.queueBaseFeePerGas[0].baseFeePerGas
        )
    }

    private async getMinMaxFeePerGas() {
        if (this.queueMaxFeePerGas.length === 0) {
            await this.getGasPrice()
        }

        return this.queueMaxFeePerGas.reduce(
            (acc: bigint, cur) => minBigInt(cur.maxFeePerGas, acc),
            this.queueMaxFeePerGas[0].maxFeePerGas
        )
    }

    private async getMinMaxPriorityFeePerGas() {
        if (this.queueMaxPriorityFeePerGas.length === 0) {
            await this.getGasPrice()
        }

        return this.queueMaxPriorityFeePerGas.reduce(
            (acc, cur) => minBigInt(cur.maxPriorityFeePerGas, acc),
            this.queueMaxPriorityFeePerGas[0].maxPriorityFeePerGas
        )
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
