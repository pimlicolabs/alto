import { GasPriceParameters } from "@alto/types"
import { Chain, PublicClient } from "viem"
import * as chains from "viem/chains"
import { maxBigInt, minBigInt } from "./bigInt"
import { Logger } from "."

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
