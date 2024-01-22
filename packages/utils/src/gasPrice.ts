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
        default: {
            return 0n
        }
    }
}

export async function getPolygonGasPriceParameters(
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

const getBumpAmount = (chainId: number) => {
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
        chainId === chains.celo.id ||
        chainId === chains.avalanche.id
    ) {
        return 111n
    }

    return 100n
}

const bumpTheGasPrice = (
    chainId: number,
    gasPriceParameters: GasPriceParameters
): GasPriceParameters => {
    const bumpAmount = getBumpAmount(chainId)

    const result = {
        maxFeePerGas: (gasPriceParameters.maxFeePerGas * bumpAmount) / 100n,
        maxPriorityFeePerGas:
            (gasPriceParameters.maxPriorityFeePerGas * bumpAmount) / 100n
    }

    if (chainId === chains.celo.id) {
        const maxFee =
            result.maxFeePerGas > result.maxPriorityFeePerGas
                ? result.maxFeePerGas
                : result.maxPriorityFeePerGas
        return {
            maxFeePerGas: maxFee,
            maxPriorityFeePerGas: maxFee
        }
    }

    return result
}

const estimateMaxPriorityFeePerGas = async (publicClient: PublicClient) => {
    try {
        const maxPriorityFeePerGasHex = await publicClient.request({
            method: "eth_maxPriorityFeePerGas"
        })
        return hexToBigInt(maxPriorityFeePerGasHex)
    } catch {
        return null
    }
}

const getFallBackMaxPriorityFeePerGas = async (
    publicClient: PublicClient,
    gasPrice: bigint
) => {
    const feeHistory = await publicClient.getFeeHistory({
        blockCount: 10,
        rewardPercentiles: [20],
        blockTag: "latest"
    })

    if (feeHistory.reward === undefined) {
        return gasPrice
    }

    const feeAverage =
        feeHistory.reward.reduce((acc, cur) => cur[0] + acc, 0n) / 10n
    return feeAverage < gasPrice ? feeAverage : gasPrice
}

const getGasPriceFromRpc = (publicClient: PublicClient) => {
    try {
        return publicClient.getGasPrice()
    } catch {
        return null
    }
}

export async function getGasPrice(
    chainId: number,
    publicClient: PublicClient,
    logger: Logger
): Promise<GasPriceParameters> {
    if (chainId === ChainId.Polygon || chainId === ChainId.Mumbai) {
        const polygonEstimate = await getPolygonGasPriceParameters(
            chainId,
            logger
        )
        if (polygonEstimate) {
            return polygonEstimate
        }
    }

    let [gasPrice, maxPriorityFeePerGas]: [bigint | null, bigint | null] =
        await Promise.all([
            getGasPriceFromRpc(publicClient),
            estimateMaxPriorityFeePerGas(publicClient)
        ])

    if (maxPriorityFeePerGas === null) {
        maxPriorityFeePerGas = await getFallBackMaxPriorityFeePerGas(
            publicClient,
            gasPrice ?? 0n
        )
    }

    if (gasPrice === null) {
        const block = await publicClient.getBlock({
            blockTag: "latest"
        })
        gasPrice = maxPriorityFeePerGas + (block.baseFeePerGas ?? 0n)
    }

    const defaultGasFee = getDefaultGasFee(chainId)

    maxPriorityFeePerGas =
        maxPriorityFeePerGas > gasPrice ? gasPrice : maxPriorityFeePerGas

    return bumpTheGasPrice(chainId, {
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas:
            maxPriorityFeePerGas > defaultGasFee
                ? maxPriorityFeePerGas
                : defaultGasFee
    })
}
