import {
    RpcError,
    gasStationResult,
    type GasPriceParameters,
    type ChainType
} from "@alto/types"
import { maxBigInt, minBigInt, type Logger } from "@alto/utils"
import * as sentry from "@sentry/node"
import { parseGwei, type Chain, type PublicClient, maxUint128 } from "viem"
import {
    celo,
    celoAlfajores,
    dfk,
    avalanche,
    polygon,
    polygonMumbai
} from "viem/chains"

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
    // biome-ignore lint/style/useDefaultSwitchClause: There are only two cases
    switch (chainId) {
        case ChainId.Polygon:
            return "https://gasstation.polygon.technology/v2"
        case ChainId.Mumbai:
            return "https://gasstation-testnet.polygon.technology/v2"
    }
}

class MantleManager {
    private queueTokenRatio: { timestamp: number; tokenRatio: bigint }[]
    private queueScalar: { timestamp: number; scalar: bigint }[]
    private queueRollupDataGasAndOverhead: {
        timestamp: number
        rollupDataGasAndOverhead: bigint
    }[]
    private queueL1GasPrice: { timestamp: number; l1GasPrice: bigint }[]

    private maxQueueSize
    private queueValidity = 15_000

    constructor(maxQueueSize: number) {
        this.maxQueueSize = maxQueueSize
        this.queueTokenRatio = []
        this.queueScalar = []
        this.queueRollupDataGasAndOverhead = []
        this.queueL1GasPrice = []
    }

    public getMinMantleOracleValues() {
        const tokenRationQueue = this.queueTokenRatio
        let minTokenRatio = 1n

        if (tokenRationQueue.length > 0) {
            minTokenRatio = tokenRationQueue.reduce(
                (acc: bigint, cur) => minBigInt(cur.tokenRatio, acc),
                tokenRationQueue[0].tokenRatio
            )
        }

        const scalarQueue = this.queueScalar
        let minScalar = 1n

        if (scalarQueue.length > 0) {
            minScalar = scalarQueue.reduce(
                (acc: bigint, cur) => minBigInt(cur.scalar, acc),
                scalarQueue[0].scalar
            )
        }

        const rollupDataGasAndOverheadQueue = this.queueRollupDataGasAndOverhead
        let minRollupDataGasAndOverhead = 1n

        if (rollupDataGasAndOverheadQueue.length > 0) {
            minRollupDataGasAndOverhead = rollupDataGasAndOverheadQueue.reduce(
                (acc: bigint, cur) =>
                    minBigInt(cur.rollupDataGasAndOverhead, acc),
                rollupDataGasAndOverheadQueue[0].rollupDataGasAndOverhead
            )
        }

        const l1GasPriceQueue = this.queueL1GasPrice
        let minL1GasPrice = 1n

        if (l1GasPriceQueue.length > 0) {
            minL1GasPrice = l1GasPriceQueue.reduce(
                (acc: bigint, cur) => minBigInt(cur.l1GasPrice, acc),
                l1GasPriceQueue[0].l1GasPrice
            )
        }

        return {
            minTokenRatio,
            minScalar,
            minRollupDataGasAndOverhead,
            minL1GasPrice
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
        this.saveTokenRatio(tokenRatio)
        this.saveScalar(scalar)
        this.saveRollupDataGasAndOverhead(rollupDataGasAndOverhead)
        this.saveL1GasPrice(l1GasPrice)
    }

    saveTokenRatio(tokenRatio: bigint) {
        if (tokenRatio === 0n) {
            return
        }

        const queue = this.queueTokenRatio
        const last = queue.length > 0 ? queue[queue.length - 1] : null
        const timestamp = Date.now()

        if (!last || timestamp - last.timestamp >= this.queueValidity) {
            if (queue.length >= this.maxQueueSize) {
                queue.shift()
            }
            queue.push({ tokenRatio, timestamp })
        } else if (tokenRatio < last.tokenRatio) {
            last.tokenRatio = tokenRatio
            last.timestamp = timestamp
        }
    }

    saveScalar(scalar: bigint) {
        if (scalar === 0n) {
            return
        }

        const queue = this.queueScalar
        const last = queue.length > 0 ? queue[queue.length - 1] : null
        const timestamp = Date.now()

        if (!last || timestamp - last.timestamp >= this.queueValidity) {
            if (queue.length >= this.maxQueueSize) {
                queue.shift()
            }
            queue.push({ scalar, timestamp })
        } else if (scalar < last.scalar) {
            last.scalar = scalar
            last.timestamp = timestamp
        }
    }

    saveRollupDataGasAndOverhead(rollupDataGasAndOverhead: bigint) {
        if (rollupDataGasAndOverhead === 0n) {
            return
        }

        const queue = this.queueRollupDataGasAndOverhead
        const last = queue.length > 0 ? queue[queue.length - 1] : null
        const timestamp = Date.now()

        if (!last || timestamp - last.timestamp >= this.queueValidity) {
            if (queue.length >= this.maxQueueSize) {
                queue.shift()
            }
            queue.push({ rollupDataGasAndOverhead, timestamp })
        } else if (rollupDataGasAndOverhead < last.rollupDataGasAndOverhead) {
            last.rollupDataGasAndOverhead = rollupDataGasAndOverhead
            last.timestamp = timestamp
        }
    }

    saveL1GasPrice(l1GasPrice: bigint) {
        if (l1GasPrice === 0n) {
            return
        }

        const queue = this.queueL1GasPrice
        const last = queue.length > 0 ? queue[queue.length - 1] : null
        const timestamp = Date.now()

        if (!last || timestamp - last.timestamp >= this.queueValidity) {
            if (queue.length >= this.maxQueueSize) {
                queue.shift()
            }
            queue.push({ l1GasPrice, timestamp })
        } else if (l1GasPrice < last.l1GasPrice) {
            last.l1GasPrice = l1GasPrice
            last.timestamp = timestamp
        }
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
    private chain: Chain
    private publicClient: PublicClient
    private legacyTransactions: boolean
    private logger: Logger
    private queueBaseFeePerGas: { timestamp: number; baseFeePerGas: bigint }[] =
        [] // Store pairs of [price, timestamp]
    private queueMaxFeePerGas: { timestamp: number; maxFeePerGas: bigint }[] =
        [] // Store pairs of [price, timestamp]
    private queueMaxPriorityFeePerGas: {
        timestamp: number
        maxPriorityFeePerGas: bigint
    }[] = [] // Store pairs of [price, timestamp]
    private maxQueueSize
    private gasBumpMultiplier: bigint
    private gasPriceRefreshIntervalInSeconds: number
    private chainType: ChainType
    public arbitrumManager: ArbitrumManager
    public mantleManager: MantleManager

    constructor(
        chain: Chain,
        publicClient: PublicClient,
        legacyTransactions: boolean,
        logger: Logger,
        gasBumpMultiplier: bigint,
        gasPriceTimeValidityInSeconds: number,
        gasPriceRefreshIntervalInSeconds: number,
        chainType: ChainType
    ) {
        this.maxQueueSize = gasPriceTimeValidityInSeconds
        this.chain = chain
        this.publicClient = publicClient
        this.legacyTransactions = legacyTransactions
        this.logger = logger
        this.gasBumpMultiplier = gasBumpMultiplier
        this.gasPriceRefreshIntervalInSeconds = gasPriceRefreshIntervalInSeconds
        this.chainType = chainType

        // Periodically update gas prices if specified
        if (this.gasPriceRefreshIntervalInSeconds > 0) {
            setInterval(() => {
                if (this.legacyTransactions === false) {
                    this.updateBaseFee()
                }

                this.updateGasPrice()
            }, this.gasPriceRefreshIntervalInSeconds * 1000)
        }

        this.arbitrumManager = new ArbitrumManager(this.maxQueueSize)
        this.mantleManager = new MantleManager(this.maxQueueSize)
    }

    public init() {
        return Promise.all([
            this.updateGasPrice(),
            this.legacyTransactions === false
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
        const gasStationUrl = getGasStationUrl(this.chain.id)
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
        const bumpAmount = this.gasBumpMultiplier

        const maxPriorityFeePerGas = maxBigInt(
            gasPriceParameters.maxPriorityFeePerGas,
            this.getDefaultGasFee(this.chain.id)
        )
        const maxFeePerGas = maxBigInt(
            gasPriceParameters.maxFeePerGas,
            maxPriorityFeePerGas
        )

        const result = {
            maxFeePerGas: (maxFeePerGas * bumpAmount) / 100n,
            maxPriorityFeePerGas: (maxPriorityFeePerGas * bumpAmount) / 100n
        }

        if (this.chain.id === celo.id || this.chain.id === celoAlfajores.id) {
            const maxFee = maxBigInt(
                result.maxFeePerGas,
                result.maxPriorityFeePerGas
            )
            return {
                maxFeePerGas: maxFee,
                maxPriorityFeePerGas: maxFee
            }
        }

        if (this.chain.id === dfk.id) {
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
        if (this.chain.id === avalanche.id) {
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
            const gasInfo = await this.publicClient.estimateFeesPerGas({
                chain: this.chain,
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
                gasPrice = await this.publicClient.getGasPrice()
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
            const fees = await this.publicClient.estimateFeesPerGas({
                chain: this.chain
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
                        this.publicClient,
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
                    (await this.getNextBaseFee(this.publicClient)) +
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
            this.chain.id === polygon.id ||
            this.chain.id === polygonMumbai.id
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

        if (this.legacyTransactions) {
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
        const latestBlock = await this.publicClient.getBlock()
        if (latestBlock.baseFeePerGas === null) {
            throw new RpcError("block does not have baseFeePerGas")
        }

        const baseFee = latestBlock.baseFeePerGas
        this.saveBaseFeePerGas(baseFee, Date.now())

        return baseFee
    }

    public getBaseFee() {
        if (this.legacyTransactions) {
            throw new RpcError(
                "baseFee is not available for legacy transactions"
            )
        }

        if (this.gasPriceRefreshIntervalInSeconds === 0) {
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
        if (this.gasPriceRefreshIntervalInSeconds === 0) {
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

        if (this.chainType === "hedera") {
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
