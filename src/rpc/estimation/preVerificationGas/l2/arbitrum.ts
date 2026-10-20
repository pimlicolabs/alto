import type { GasPriceManager } from "@alto/handlers"
import { type Address, ArbitrumL1FeeAbi, type UserOperation } from "@alto/types"
import { scaleBigIntByPercent } from "@alto/utils"
import {
    type Chain,
    type PublicClient,
    type Transport,
    getContract
} from "viem"
import { getSerializedHandleOpsTx } from "../serializedHandleOpsTx"

// Shared utility for Arbitrum L1 gas estimation
export async function getArbitrumL1GasEstimate({
    publicClient,
    userOps,
    entryPoint
}: {
    publicClient: PublicClient<Transport, Chain | undefined>
    userOps: UserOperation[]
    entryPoint: Address
}): Promise<{
    gasForL1: bigint
    l2BaseFee: bigint
    l1BaseFeeEstimate: bigint
}> {
    const precompileAddress = "0x00000000000000000000000000000000000000C8"

    const serializedTx = getSerializedHandleOpsTx({
        userOps,
        entryPoint,
        chainId: publicClient.chain?.id ?? 10,
        removeZeros: false
    })

    const arbGasPriceOracle = getContract({
        abi: ArbitrumL1FeeAbi,
        address: precompileAddress,
        client: {
            public: publicClient
        }
    })

    const { result } = await arbGasPriceOracle.simulate.gasEstimateL1Component([
        entryPoint,
        false,
        serializedTx
    ])

    const [gasForL1, l2BaseFee, l1BaseFeeEstimate] = result

    return { gasForL1, l2BaseFee, l1BaseFeeEstimate }
}

export async function getArbitrumPvg(
    publicClient: PublicClient<Transport, Chain | undefined>,
    userOp: UserOperation,
    entryPoint: Address,
    gasPriceManager: GasPriceManager,
    validate: boolean
) {
    const { gasForL1, l2BaseFee, l1BaseFeeEstimate } =
        await getArbitrumL1GasEstimate({
            publicClient,
            userOps: [userOp],
            entryPoint
        })

    const arbitrumManager = gasPriceManager.arbitrumManager

    arbitrumManager.saveL1BaseFee(l1BaseFeeEstimate)
    arbitrumManager.saveL2BaseFee(l2BaseFee)

    if (validate) {
        const [maxL1Fee, minL1Fee, maxL2BaseFee, minL2BaseFee] =
            await Promise.all([
                l1BaseFeeEstimate || arbitrumManager.getMaxL1BaseFee(),
                arbitrumManager.getMinL1BaseFee(),
                arbitrumManager.getMaxL2BaseFee(),
                arbitrumManager.getMinL2BaseFee()
            ])

        const pvg =
            (gasForL1 * minL2BaseFee * minL1Fee) / (maxL1Fee * maxL2BaseFee)

        // Accept 5% tolerance during validation to account for changes in L1State during getArbitrumL1GasEstimate.
        return scaleBigIntByPercent(pvg, 95n)
    }

    return gasForL1
}
