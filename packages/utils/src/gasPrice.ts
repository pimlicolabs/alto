import { GasPriceParameters } from "@alto/types"
import { Chain, PublicClient, parseGwei } from "viem"
import * as chains from "viem/chains"
import { maxBigInt, minBigInt } from "./bigInt"

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

    if (chainId === chains.celo.id || chainId === chains.celoAlfajores.id) {
        const maxFee = maxBigInt(result.maxFeePerGas, result.maxPriorityFeePerGas)
        return {
            maxFeePerGas: maxFee,
            maxPriorityFeePerGas: maxFee
        }
    }

    return result
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

    if (feeHistory.reward === undefined) {
        return gasPrice
    }

    const feeAverage = feeHistory.reward.reduce((acc, cur) => cur[0] + acc, 0n) / 10n
    return minBigInt(feeAverage, gasPrice)
}

/// formula taken from: https://eips.ethereum.org/EIPS/eip-1559
const getNextBaseFee = async (publicClient: PublicClient) => {
    const block = await publicClient.getBlock({
        blockTag: "latest"
    })
    const currentBaseFeePerGas = block.baseFeePerGas || parseGwei("30")
    const currentGasUsed = block.gasUsed
    const gasTarget = block.gasLimit / 2n

    const gasUsedDelta = currentGasUsed - gasTarget
    const baseFeePerGasDelta = currentBaseFeePerGas * gasUsedDelta / gasTarget / 8n

    if (currentGasUsed === gasTarget) {
        return currentBaseFeePerGas
    }

    if (currentGasUsed > gasTarget) {
        return currentBaseFeePerGas + baseFeePerGasDelta
    }

    return currentBaseFeePerGas - baseFeePerGasDelta
}

export async function getGasPrice(
    chain: Chain,
    publicClient: PublicClient,
    noEip1559Support: boolean
): Promise<GasPriceParameters> {
    if (noEip1559Support) {
        let { gasPrice } = await publicClient.estimateFeesPerGas({ chain, type: "legacy" })

        if (gasPrice === undefined) {
            gasPrice = await publicClient.getGasPrice()
        }

        return bumpTheGasPrice(chain.id, {
            maxFeePerGas: gasPrice,
            maxPriorityFeePerGas: gasPrice,
        })
    }

    let { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas({ chain })

    if (maxPriorityFeePerGas === undefined) {
        maxPriorityFeePerGas = await getFallBackMaxPriorityFeePerGas(
            publicClient,
            maxFeePerGas ?? 0n
        )
    }

    if (maxFeePerGas === undefined) {
        maxFeePerGas = await getNextBaseFee(publicClient) + maxPriorityFeePerGas
    }

    return bumpTheGasPrice(chain.id, {
        maxFeePerGas,
        maxPriorityFeePerGas,
    })
}
