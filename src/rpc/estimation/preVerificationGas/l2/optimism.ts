import type { GasPriceManager } from "@alto/handlers"
import { type Address, OpL1FeeAbi, type UserOperation } from "@alto/types"
import { minBigInt } from "@alto/utils"
import {
    type Chain,
    type PublicClient,
    type Transport,
    getContract
} from "viem"
import { getSerializedHandleOpsTx } from "../serializedHandleOpsTx"

export async function calcOptimismPvg(
    publicClient: PublicClient<Transport, Chain>,
    userOp: UserOperation,
    entryPoint: Address,
    gasPriceManager: GasPriceManager,
    validate: boolean
) {
    const serializedTx = getSerializedHandleOpsTx({
        userOps: [userOp],
        entryPoint,
        chainId: publicClient.chain.id,
        removeZeros: false,
        randomizeSignature: !validate
    })

    const opGasPriceOracle = getContract({
        abi: OpL1FeeAbi,
        address: "0x420000000000000000000000000000000000000F",
        client: {
            public: publicClient
        }
    })

    const [l1Fee, baseFeePerGas] = await Promise.all([
        validate
            ? gasPriceManager.optimismManager.getMinL1Fee()
            : opGasPriceOracle.read.getL1Fee([serializedTx]),
        validate
            ? gasPriceManager.getMaxBaseFeePerGas()
            : gasPriceManager.getBaseFee()
    ])

    let l2MaxFee: bigint
    let l2PriorityFee: bigint

    if (validate) {
        l2MaxFee = await gasPriceManager.getHighestMaxFeePerGas()
        l2PriorityFee =
            baseFeePerGas +
            (await gasPriceManager.getHighestMaxPriorityFeePerGas())
    } else {
        const gasPrices = await gasPriceManager.getGasPrice()
        l2MaxFee = gasPrices.maxFeePerGas
        l2PriorityFee = baseFeePerGas + gasPrices.maxPriorityFeePerGas
    }

    const l2price = minBigInt(l2MaxFee, l2PriorityFee)

    return l1Fee / l2price
}
