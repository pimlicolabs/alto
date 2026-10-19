import type { GasPriceManager } from "@alto/handlers"
import {
    type Address,
    MantleBvmGasPriceOracleAbi,
    type UserOperation
} from "@alto/types"
import type { Chain, PublicClient, Transport } from "viem"
import { getSerializedHandleOpsTx } from "../serializedHandleOpsTx"

export async function calcMantlePvg(
    publicClient: PublicClient<Transport, Chain>,
    userOp: UserOperation,
    entryPoint: Address,
    gasPriceManager: GasPriceManager,
    verify?: boolean
) {
    const serializedTx = getSerializedHandleOpsTx({
        userOps: [userOp],
        entryPoint,
        chainId: publicClient.chain.id
    })

    let tokenRatio: bigint
    let scalar: bigint
    let rollupDataGasAndOverhead: bigint
    let l1GasPrice: bigint

    const mantleManager = gasPriceManager.mantleManager

    if (verify) {
        const minValues = await mantleManager.getMinMantleOracleValues()

        tokenRatio = minValues.minTokenRatio
        scalar = minValues.minScalar
        rollupDataGasAndOverhead = minValues.minRollupDataGasAndOverhead
        l1GasPrice = minValues.minL1GasPrice
    } else {
        ;[tokenRatio, scalar, rollupDataGasAndOverhead, l1GasPrice] =
            await Promise.all([
                publicClient.readContract({
                    address: "0x420000000000000000000000000000000000000F",
                    abi: MantleBvmGasPriceOracleAbi,
                    functionName: "tokenRatio"
                }),
                publicClient.readContract({
                    address: "0x420000000000000000000000000000000000000F",
                    abi: MantleBvmGasPriceOracleAbi,
                    functionName: "scalar"
                }),
                publicClient.readContract({
                    address: "0x420000000000000000000000000000000000000F",
                    abi: MantleBvmGasPriceOracleAbi,
                    functionName: "getL1GasUsed",
                    args: [serializedTx]
                }),
                publicClient.readContract({
                    address: "0x420000000000000000000000000000000000000F",
                    abi: MantleBvmGasPriceOracleAbi,
                    functionName: "l1BaseFee"
                })
            ])

        mantleManager.saveMantleOracleValues({
            tokenRatio,
            scalar,
            rollupDataGasAndOverhead,
            l1GasPrice
        })
    }

    const mantleL1RollUpFeeDivisionFactor = 1_000_000n

    const l1RollupFee =
        (rollupDataGasAndOverhead * l1GasPrice * tokenRatio * scalar) /
        mantleL1RollUpFeeDivisionFactor

    const maxFeePerGas = await (verify
        ? gasPriceManager.getHighestMaxFeePerGas()
        : gasPriceManager.getGasPrice().then((res) => res.maxFeePerGas))
    const l2MaxFee = BigInt(maxFeePerGas)

    return l1RollupFee / l2MaxFee
}
