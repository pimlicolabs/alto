import { GasPriceParameters, gasStationResult } from "@alto/types"
import { Chain, PublicClient, parseGwei } from "viem"
import * as chains from "viem/chains"
import { maxBigInt, minBigInt } from "./bigInt"
import { Logger } from "."


function getGasStationUrl(chainId: chains.polygon.id | chains.polygonMumbai.id): string {
    switch (chainId) {
        case chains.polygon.id:
            return "https://gasstation.polygon.technology/v2"
        case chains.polygonMumbai.id:
            return "https://gasstation-testnet.polygon.technology/v2"
    }
}

const MIN_POLYGON_GAS_PRICE = parseGwei("31")
const MIN_MUMBAI_GAS_PRICE = parseGwei("1")

/**
 * @internal
 */
function getDefaultGasFee(chainId: chains.polygon.id | chains.polygonMumbai.id): bigint {
    switch (chainId) {
        case chains.polygon.id:
            return MIN_POLYGON_GAS_PRICE
        case chains.polygonMumbai.id:
            return MIN_MUMBAI_GAS_PRICE
        default: {
            return 0n
        }
    }
}

export async function getPolygonGasPriceParameters(
    chainId: chains.polygon.id | chains.polygonMumbai.id,
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

const getFallBackMaxPriorityFeePerGas = async (
    publicClient: PublicClient,
    gasPrice: bigint
): Promise<bigint> => {
    const feeHistory = await publicClient.getFeeHistory({
        blockCount: 10,
        rewardPercentiles: [20],
        blockTag: "latest"
    })

    if (feeHistory.reward === undefined || feeHistory.reward === null) {
        return gasPrice
    }

    const feeAverage = feeHistory.reward.reduce((acc, cur) => cur[0] + acc, 0n) / 10n
    return minBigInt(feeAverage, gasPrice)
}

/// Formula taken from: https://eips.ethereum.org/EIPS/eip-1559
const getNextBaseFee = async (publicClient: PublicClient) => {
    const block = await publicClient.getBlock({
        blockTag: "latest"
    })
    const currentBaseFeePerGas = block.baseFeePerGas || await publicClient.getGasPrice()
    const currentGasUsed = block.gasUsed
    const gasTarget = block.gasLimit / 2n

    if (currentGasUsed === gasTarget) {
        return currentBaseFeePerGas
    }

    if (currentGasUsed > gasTarget) {
        const gasUsedDelta = currentGasUsed - gasTarget
        const baseFeePerGasDelta = maxBigInt(currentBaseFeePerGas * gasUsedDelta / gasTarget / 8n, 1n)
        return currentBaseFeePerGas + baseFeePerGasDelta
    }

    const gasUsedDelta = currentGasUsed - gasTarget
    const baseFeePerGasDelta = currentBaseFeePerGas * gasUsedDelta / gasTarget / 8n
    return currentBaseFeePerGas - baseFeePerGasDelta
}

export async function getGasPrice(
    chain: Chain,
    publicClient: PublicClient,
    noEip1559Support: boolean,
    logger: Logger
): Promise<GasPriceParameters> {
    if (chain.id === chains.polygon.id || chain.id === chains.polygonMumbai.id) {
        const polygonEstimate = await getPolygonGasPriceParameters(
            chain.id,
            logger
        )
        if (polygonEstimate) {
            return {
                maxFeePerGas: polygonEstimate.maxFeePerGas,
                maxPriorityFeePerGas: maxBigInt(polygonEstimate.maxPriorityFeePerGas, getDefaultGasFee(chain.id))
            }
        }
    }

    let maxFeePerGas: bigint | undefined
    let maxPriorityFeePerGas: bigint | undefined
    if (noEip1559Support) {
        let { gasPrice } = await publicClient.estimateFeesPerGas({ chain, type: "legacy" })

        if (gasPrice === undefined) {
            logger.info("failed to get legacy gasPrice, using fallback value")
            gasPrice = await publicClient.getGasPrice()
        }

        return {
            maxFeePerGas: gasPrice,
            maxPriorityFeePerGas: gasPrice
        }
    }

    const fees = await publicClient.estimateFeesPerGas({ chain })
    maxFeePerGas = fees.maxFeePerGas
    maxPriorityFeePerGas = fees.maxPriorityFeePerGas

    if (maxPriorityFeePerGas === undefined) {
        logger.info("failed to get maxPriorityFeePerGas, using fallback value")
        maxPriorityFeePerGas = await getFallBackMaxPriorityFeePerGas(
            publicClient,
            maxFeePerGas ?? 0n
        )
    }

    if (maxFeePerGas === undefined) {
        logger.info("failed to get maxFeePerGas, using fallback value")
        maxFeePerGas = await getNextBaseFee(publicClient) + maxPriorityFeePerGas
    }

    const bumpAmount = getBumpAmount(chain.id)
    maxPriorityFeePerGas = (maxPriorityFeePerGas * bumpAmount) / 100n
    maxFeePerGas = (maxFeePerGas * bumpAmount) / 100n

    if (maxPriorityFeePerGas === 0n) {
        maxPriorityFeePerGas = maxFeePerGas / 200n
    }

    if (chain.id === chains.celo.id || chain.id === chains.celoAlfajores.id) {
        const maxfee = maxBigInt(maxFeePerGas, maxPriorityFeePerGas)
        maxPriorityFeePerGas = maxfee
        maxFeePerGas = maxfee
    }

    return {
        maxFeePerGas: maxBigInt(maxFeePerGas, maxPriorityFeePerGas),
        maxPriorityFeePerGas,
    }
}
