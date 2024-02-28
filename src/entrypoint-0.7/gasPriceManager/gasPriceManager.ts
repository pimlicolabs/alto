import {
    gasStationResult,
    type GasPriceParameters,
    RpcError
} from "@entrypoint-0.7/types"
import { parseGwei, type Chain, type PublicClient } from "viem"
import { type Logger, maxBigInt, minBigInt } from "@alto/utils"
import * as chains from "viem/chains"
import * as sentry from "@sentry/node"

export interface InterfaceGasPriceManager {
    getGasPrice(
        chain: Chain,
        publicClient: PublicClient,
        noEip1559Support: boolean,
        logger: Logger
    ): Promise<GasPriceParameters>
    validateGasPrice(gasPrice: GasPriceParameters): void
}

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

export class GasPriceManager implements InterfaceGasPriceManager {
    private lowestGasPrice: GasPriceParameters
    private lowestGasPriceTimestamp: number
    private gasPriceTimeValidity: number

    constructor(gasPriceTimeValidityInSeconds: number) {
        this.lowestGasPrice = {
            maxFeePerGas: BigInt(2) ** BigInt(53) - BigInt(1),
            maxPriorityFeePerGas: BigInt(2) ** BigInt(53) - BigInt(1)
        }
        this.lowestGasPriceTimestamp = 0
        this.gasPriceTimeValidity = gasPriceTimeValidityInSeconds * 1000
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

    private async getPolygonGasPriceParameters(
        chainId: ChainId.Polygon | ChainId.Mumbai,
        logger: Logger
    ): Promise<GasPriceParameters | null> {
        const gasStationUrl = getGasStationUrl(chainId)
        try {
            const data = await (await fetch(gasStationUrl)).json()
            // take the standard speed here, SDK options will define the extra tip
            const parsedData = gasStationResult.parse(data)

            return parsedData.fast
        } catch (e) {
            logger.error(
                { error: e },
                "failed to get gas price from gas station, using default"
            )
            return null
        }
    }

    private getBumpAmount(chainId: number) {
        if (chainId === chains.sepolia.id) {
            return 120n
        }

        if (chainId === chains.celo.id) {
            return 150n
        }

        if (
            chainId === chains.arbitrum.id ||
            chainId === chains.scroll.id ||
            chainId === chains.scrollSepolia.id ||
            chainId === chains.arbitrumGoerli.id ||
            chainId === chains.mainnet.id ||
            chainId === chains.mantle.id ||
            chainId === 22222 ||
            chainId === chains.sepolia.id ||
            chainId === chains.base.id ||
            chainId === chains.dfk.id ||
            chainId === chains.celoAlfajores.id ||
            chainId === chains.celoCannoli.id ||
            chainId === chains.avalanche.id
        ) {
            return 111n
        }

        return 100n
    }

    private bumpTheGasPrice(
        chainId: number,
        gasPriceParameters: GasPriceParameters
    ): GasPriceParameters {
        const bumpAmount = this.getBumpAmount(chainId)

        const maxPriorityFeePerGas = maxBigInt(
            gasPriceParameters.maxPriorityFeePerGas,
            this.getDefaultGasFee(chainId)
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
            chainId === chains.celo.id ||
            chainId === chains.celoAlfajores.id ||
            chainId === chains.celoCannoli.id
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

    private async getNoEip1559SupportGasPrice(
        publicClient: PublicClient,
        chain: Chain,
        logger: Logger
    ): Promise<GasPriceParameters> {
        let gasPrice: bigint | undefined
        try {
            const gasInfo = await publicClient.estimateFeesPerGas({
                chain,
                type: "legacy"
            })
            gasPrice = gasInfo.gasPrice
        } catch (e) {
            sentry.captureException(e)
            logger.error(
                "failed to fetch legacy gasPrices from estimateFeesPerGas",
                { error: e }
            )
            gasPrice = undefined
        }

        if (gasPrice === undefined) {
            logger.warn("gasPrice is undefined, using fallback value")
            try {
                gasPrice = await publicClient.getGasPrice()
            } catch (e) {
                logger.error("failed to get fallback gasPrice")
                sentry.captureException(e)
                throw e
            }
        }

        return {
            maxFeePerGas: gasPrice,
            maxPriorityFeePerGas: gasPrice
        }
    }

    private async estimateGasPrice(
        chain: Chain,
        publicClient: PublicClient,
        logger: Logger
    ): Promise<GasPriceParameters> {
        let maxFeePerGas: bigint | undefined
        let maxPriorityFeePerGas: bigint | undefined
        try {
            const fees = await publicClient.estimateFeesPerGas({ chain })
            maxFeePerGas = fees.maxFeePerGas
            maxPriorityFeePerGas = fees.maxPriorityFeePerGas
        } catch (e) {
            sentry.captureException(e)
            logger.error(
                "failed to fetch eip-1559 gasPrices from estimateFeesPerGas",
                { error: e }
            )
            maxFeePerGas = undefined
            maxPriorityFeePerGas = undefined
        }

        if (maxPriorityFeePerGas === undefined) {
            logger.warn(
                "maxPriorityFeePerGas is undefined, using fallback value"
            )
            try {
                maxPriorityFeePerGas =
                    await this.getFallBackMaxPriorityFeePerGas(
                        publicClient,
                        maxFeePerGas ?? 0n
                    )
            } catch (e) {
                logger.error("failed to get fallback maxPriorityFeePerGas")
                sentry.captureException(e)
                throw e
            }
        }

        if (maxFeePerGas === undefined) {
            logger.warn("maxFeePerGas is undefined, using fallback value")
            try {
                maxFeePerGas =
                    (await this.getNextBaseFee(publicClient)) +
                    maxPriorityFeePerGas
            } catch (e) {
                logger.error("failed to get fallback maxFeePerGas")
                sentry.captureException(e)
                throw e
            }
        }

        if (maxPriorityFeePerGas === 0n) {
            maxPriorityFeePerGas = maxFeePerGas / 200n
        }

        return { maxFeePerGas, maxPriorityFeePerGas }
    }

    private saveGasPrice(gasPrice: GasPriceParameters) {
        this.lowestGasPrice = {
            maxFeePerGas: minBigInt(
                gasPrice.maxFeePerGas,
                this.lowestGasPrice.maxFeePerGas
            ),
            maxPriorityFeePerGas: minBigInt(
                gasPrice.maxPriorityFeePerGas,
                this.lowestGasPrice.maxPriorityFeePerGas
            )
        }
        this.lowestGasPriceTimestamp = Date.now()
    }

    public async getGasPrice(
        chain: Chain,
        publicClient: PublicClient,
        noEip1559Support: boolean,
        logger: Logger
    ): Promise<GasPriceParameters> {
        if (
            chain.id === chains.polygon.id ||
            chain.id === chains.polygonMumbai.id
        ) {
            const polygonEstimate = await this.getPolygonGasPriceParameters(
                chain.id,
                logger
            )
            if (polygonEstimate) {
                const gasPrice = this.bumpTheGasPrice(chain.id, {
                    maxFeePerGas: polygonEstimate.maxFeePerGas,
                    maxPriorityFeePerGas: polygonEstimate.maxPriorityFeePerGas
                })
                this.saveGasPrice(gasPrice)
                return gasPrice
            }
        }

        if (noEip1559Support) {
            const gasPrice = this.bumpTheGasPrice(
                chain.id,
                await this.getNoEip1559SupportGasPrice(
                    publicClient,
                    chain,
                    logger
                )
            )
            this.saveGasPrice(gasPrice)
            return gasPrice
        }

        const { maxFeePerGas, maxPriorityFeePerGas } =
            await this.estimateGasPrice(chain, publicClient, logger)

        const gasPrice = this.bumpTheGasPrice(chain.id, {
            maxFeePerGas,
            maxPriorityFeePerGas
        })
        this.saveGasPrice(gasPrice)
        return gasPrice
    }

    public validateGasPrice(gasPrice: GasPriceParameters) {
        const now = Date.now()
        if (now - this.lowestGasPriceTimestamp > this.gasPriceTimeValidity) {
            throw new RpcError(
                "Gas price is outdated, use pimlico_getUserOperationGasPrice to get the current gas price"
            )
        }

        if (gasPrice.maxFeePerGas < this.lowestGasPrice.maxFeePerGas) {
            throw new RpcError(
                `maxFeePerGas must be at least ${this.lowestGasPrice.maxFeePerGas} (current maxFeePerGas: ${gasPrice.maxFeePerGas}) - use pimlico_getUserOperationGasPrice to get the current gas price`
            )
        }

        if (
            gasPrice.maxPriorityFeePerGas <
            this.lowestGasPrice.maxPriorityFeePerGas
        ) {
            throw new RpcError(
                `maxPriorityFeePerGas must be at least ${this.lowestGasPrice.maxPriorityFeePerGas} (current maxPriorityFeePerGas: ${gasPrice.maxPriorityFeePerGas}) - use pimlico_getUserOperationGasPrice to get the current gas price`
            )
        }
    }
}
