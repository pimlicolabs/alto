import crypto from "node:crypto"
import { encodeHandleOpsCalldata } from "@alto/executor"
import type { Address, UserOperation } from "@alto/types"
import {
    concat,
    maxUint64,
    serializeTransaction,
    size,
    slice,
    toHex
} from "viem"
import { fillUserOpWithDummyData } from "./encodeUserOp"

// Helper function to serialize transaction with default values
function serializeTxWithDefaults(txParams: any) {
    // Default values for required fields
    txParams.nonce = 999999
    txParams.gasLimit = maxUint64
    txParams.maxFeePerGas = maxUint64
    txParams.maxPriorityFeePerGas = maxUint64

    // Always use EIP-1559 transaction
    return serializeTransaction(txParams, {
        r: "0x123451234512345123451234512345123451234512345123451234512345",
        s: "0x123451234512345123451234512345123451234512345123451234512345",
        yParity: 1
    })
}

// Returns a serialized transaction for the handleOps call
export function getSerializedHandleOpsTx({
    userOps,
    entryPoint,
    chainId,
    removeZeros = true,
    randomizeSignature = false
}: {
    userOps: UserOperation[]
    entryPoint: Address
    chainId: number
    removeZeros?: boolean
    randomizeSignature?: boolean
}) {
    if (userOps.length === 0) {
        throw new Error("No user operations provided")
    }

    // Process operations based on configuration
    let processedOps = userOps

    if (randomizeSignature) {
        processedOps = userOps.map((userOp) => {
            const sigLength = size(userOp.signature)
            let newSignature: `0x${string}`

            const randomizeBytes = (length: number) =>
                toHex(crypto.randomBytes(length).toString("hex"))

            if (sigLength < 65) {
                // For short signatures, randomize the entire thing
                newSignature = randomizeBytes(sigLength)
            } else {
                // For longer signatures, only randomize the last 65 bytes
                const originalPart = slice(userOp.signature, 0, sigLength - 65)
                const randomPart = randomizeBytes(65)
                newSignature = concat([originalPart, randomPart])
            }

            return {
                ...userOp,
                signature: newSignature
            }
        })
    }

    // Apply removeZeros logic if needed
    const finalOps = removeZeros
        ? processedOps.map((userOp) => fillUserOpWithDummyData(userOp))
        : processedOps

    const data = encodeHandleOpsCalldata({
        userOps: finalOps,
        beneficiary: entryPoint
    })

    // Prepare transaction parameters
    const txParams = {
        to: entryPoint,
        chainId,
        data
    }

    return serializeTxWithDefaults(txParams)
}
