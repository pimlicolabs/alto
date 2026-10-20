import type { GasPriceManager } from "@alto/handlers"
import type { Address, UserOperation } from "@alto/types"
import { parseEther, size } from "viem"
import { getSerializedHandleOpsTx } from "../serializedHandleOpsTx"

export async function getEtherlinkPvg(
    userOp: UserOperation,
    entryPoint: Address,
    gasPriceManager: GasPriceManager,
    verify?: boolean
) {
    const serializedTx = getSerializedHandleOpsTx({
        userOps: [userOp],
        entryPoint,
        chainId: 128123 // Etherlink chain ID
    })

    // Etherlink calculates the inclusion fee (data availability fee) with:
    // 0.000004 XTZ * (150 + tx.data.size() + tx.access_list.size())

    // Get the size of serialized transaction in bytes
    const dataSize = BigInt(size(serializedTx))

    const baseConstant = 150n
    const xtzRate = parseEther("0.000004")

    const inclusionFee = (baseConstant + dataSize) * xtzRate

    // Get the current gas price to convert the inclusion fee to gas units
    const maxFeePerGas = await (verify
        ? gasPriceManager.getHighestMaxFeePerGas()
        : gasPriceManager.getGasPrice().then((res) => res.maxFeePerGas))

    // Convert the inclusion fee to gas units
    const inclusionFeeInGas = inclusionFee / maxFeePerGas

    return inclusionFeeInGas
}
