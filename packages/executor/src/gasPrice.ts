import { GasPriceParameters, gasStationResult } from "@alto/types"
import { PublicClient, parseGwei } from "viem"
import { Logger } from "@alto/utils"

enum ChainId {
    Polygon = 137,
    Mumbai = 80001,
    LineaTestnet = 59140
}

function getGasStationUrl(chainId: ChainId.Polygon | ChainId.Mumbai): string {
    switch (chainId) {
        case ChainId.Polygon:
            return "https://gasstation-mainnet.matic.network/v2"
        case ChainId.Mumbai:
            return "https://gasstation-mumbai.matic.today/v2"
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

    return {
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: getDefaultGasFee(chainId)
    }
}

export async function getGasPrice(
    chainId: number,
    publicClient: PublicClient,
    logger: Logger
): Promise<GasPriceParameters> {
    if (chainId === ChainId.Polygon || chainId === ChainId.Mumbai) {
        return await getPolygonGasPriceParameters(publicClient, chainId, logger)
    }

    let gasPrice = await publicClient.getGasPrice()

    let maxPriorityFeePerGas = 2_000_000_000n > gasPrice ? gasPrice : 2_000_000_000n
    if (chainId === ChainId.LineaTestnet) {
        gasPrice = gasPrice * 4n / 3n;
        maxPriorityFeePerGas = gasPrice;
    }

    return {
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas
    }
}
