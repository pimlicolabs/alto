import { GasPriceParameters, gasStationResult } from "@alto/types"
import { PublicClient, parseGwei } from "viem"
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
        logger.error(
            { error: e },
            "failed to get gas price from gas station, using default"
        )
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

    if (chainId === chains.celo.id) {
        gasPrice = (gasPrice * 3n) / 2n
        return {
            maxFeePerGas: gasPrice,
            maxPriorityFeePerGas: gasPrice
        }
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
        gasPrice = (gasPrice * 10n) / 9n
        return {
            maxFeePerGas: gasPrice,
            maxPriorityFeePerGas: gasPrice
        }
    }

    let maxPriorityFeePerGas =
        2_000_000_000n > gasPrice ? gasPrice : 2_000_000_000n
    const feeHistory = await publicClient.getFeeHistory({
        blockCount: 10,
        rewardPercentiles: [20],
        blockTag: "latest"
    })

    if (feeHistory.reward === undefined) {
        gasPrice = (gasPrice * 3n) / 2n
        maxPriorityFeePerGas = gasPrice
    } else {
        const feeAverage =
            feeHistory.reward.reduce((acc, cur) => cur[0] + acc, 0n) / 10n
        if (feeAverage > gasPrice) {
            gasPrice = feeAverage
        }
        maxPriorityFeePerGas = gasPrice
    }

    if (chainId === chains.lineaTestnet.id) {
        gasPrice = (gasPrice > parseGwei("20")) ? gasPrice : parseGwei("20");
    }

    return {
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas
    }
}
