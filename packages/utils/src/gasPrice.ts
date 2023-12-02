import { GasPriceParameters, gasStationResult } from "@alto/types"
import { PublicClient, hexToBigInt, parseGwei } from "viem"
import * as chains from "viem/chains"
import { Logger } from "."

enum ChainId {
    Goerli = 5,
    Polygon = 137,
    Mumbai = 80001,
    LineaTestnet = 59140,
    Linea = 59144
}

function getGasStationUrl(chainId: ChainId.Polygon | ChainId.Mumbai): string {
    switch (chainId) {
        case ChainId.Polygon:
            return "https://gasstation.polygon.technology/v2"
        case ChainId.Mumbai:
            return "https://gasstation-testnet.polygon.technology/v2"
    }
}

const MIN_POLYGON_GAS_PRICE = parseGwei("31")
const MIN_MUMBAI_GAS_PRICE = parseGwei("1")

/**
 * @internal
 */
function getDefaultGasFee(chainId: ChainId.Polygon | ChainId.Mumbai): bigint {
    switch (chainId) {
        case ChainId.Polygon:
            return MIN_POLYGON_GAS_PRICE
        case ChainId.Mumbai:
            return MIN_MUMBAI_GAS_PRICE
    }
}

export async function getPolygonGasPriceParameters(
    publicClient: PublicClient,
    chainId: ChainId.Polygon | ChainId.Mumbai,
    logger: Logger
): Promise<GasPriceParameters> {
    const gasStationUrl = getGasStationUrl(chainId)
    try {
        const data = await (await fetch(gasStationUrl)).json()
        // take the standard speed here, SDK options will define the extra tip
        const parsedData = gasStationResult.parse(data)

        return parsedData.fast
    } catch (e) {
        logger.error({ error: e }, "failed to get gas price from gas station, using default")
    }

    const gasPrice = await publicClient.getGasPrice()

    const maxPriorityFeePerGas = await estimateMaxPriorityFeePerGas(publicClient, gasPrice)
    const defaultGasFee = getDefaultGasFee(chainId)

    return {
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: maxPriorityFeePerGas > defaultGasFee ? maxPriorityFeePerGas : defaultGasFee
    }
}

const getBumpAmount = (chainId: number) => {
    if (chainId === chains.celo.id) {
        return 150n
    }

    if (
        chainId === chains.arbitrum.id ||
        chainId === chains.scrollSepolia.id ||
        chainId === chains.arbitrumGoerli.id ||
        chainId === chains.mantle.id ||
        chainId === chains.mainnet.id ||
        chainId === chains.celoAlfajores.id
    ) {
        return 111n
    }

    return 110n
}

const bumpTheGasPrice = (chainId: number, gasPriceParameters: GasPriceParameters): GasPriceParameters => {
    const bumpAmount = getBumpAmount(chainId)

    return {
        maxFeePerGas: (gasPriceParameters.maxFeePerGas * bumpAmount) / 100n,
        maxPriorityFeePerGas: (gasPriceParameters.maxPriorityFeePerGas * bumpAmount) / 100n
    }
}

const estimateMaxPriorityFeePerGas = async (publicClient: PublicClient, gasPrice: bigint) => {
    try {
        const maxPriorityFeePerGasHex = await publicClient.request({
            method: "eth_maxPriorityFeePerGas"
        })
        return hexToBigInt(maxPriorityFeePerGasHex)
    } catch {
        let maxPriorityFeePerGas = 2_000_000_000n > gasPrice ? gasPrice : 2_000_000_000n
        const feeHistory = await publicClient.getFeeHistory({
            blockCount: 10,
            rewardPercentiles: [20],
            blockTag: "latest"
        })

        if (feeHistory.reward === undefined) {
            maxPriorityFeePerGas = (gasPrice * 3n) / 2n
        } else {
            const feeAverage = feeHistory.reward.reduce((acc, cur) => cur[0] + acc, 0n) / 10n
            maxPriorityFeePerGas = feeAverage > gasPrice ? feeAverage : gasPrice
        }

        return maxPriorityFeePerGas
    }
}

export async function getGasPrice(
    chainId: number,
    publicClient: PublicClient,
    logger: Logger
): Promise<GasPriceParameters> {
    const block = await publicClient.getBlock({
        blockTag: "pending"
    })

    const baseFeePerGas: bigint = block.baseFeePerGas || 2_000_000_000n
    let maxFeePerGas: bigint
    let maxPriorityFeePerGas: bigint

    if (chainId === ChainId.Polygon || chainId === ChainId.Mumbai) {
        const polygonEstimate = await getPolygonGasPriceParameters(publicClient, chainId, logger)
        maxPriorityFeePerGas = polygonEstimate.maxPriorityFeePerGas
        maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas

        return bumpTheGasPrice(chainId, {
            maxFeePerGas: maxFeePerGas > polygonEstimate.maxFeePerGas ? maxFeePerGas : polygonEstimate.maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas
        })
    }

    const gasPrice = await publicClient.getGasPrice()

    maxPriorityFeePerGas = await estimateMaxPriorityFeePerGas(publicClient, gasPrice)
    maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas

    return bumpTheGasPrice(chainId, {
        maxFeePerGas: gasPrice > maxFeePerGas ? gasPrice : maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFeePerGas
    })
}
