import type { UserOperation } from "@alto/types"
import { isVersion06, toPackedUserOp } from "@alto/utils"
import {
    bytesToHex,
    encodeAbiParameters,
    maxUint128,
    maxUint256,
    size,
    toBytes
} from "viem"

// Encodes a user operation into bytes for gas calculation
export function encodeUserOp(userOp: UserOperation): Uint8Array {
    const filledUserOp = fillUserOpWithDummyData(userOp)

    if (isVersion06(filledUserOp)) {
        return toBytes(
            encodeAbiParameters(
                [
                    {
                        components: [
                            { name: "sender", type: "address" },
                            { name: "nonce", type: "uint256" },
                            { name: "initCode", type: "bytes" },
                            { name: "callData", type: "bytes" },
                            { name: "callGasLimit", type: "uint256" },
                            { name: "verificationGasLimit", type: "uint256" },
                            { name: "preVerificationGas", type: "uint256" },
                            { name: "maxFeePerGas", type: "uint256" },
                            { name: "maxPriorityFeePerGas", type: "uint256" },
                            { name: "paymasterAndData", type: "bytes" },
                            { name: "signature", type: "bytes" }
                        ],
                        name: "userOperation",
                        type: "tuple"
                    }
                ],
                [filledUserOp]
            )
        )
    }

    // For 0.7, 0.8, 0.9 we need to pack the user operation
    const packedUserOp = toPackedUserOp(filledUserOp)
    return toBytes(
        encodeAbiParameters(
            [
                {
                    components: [
                        { name: "sender", type: "address" },
                        { name: "nonce", type: "uint256" },
                        { name: "initCode", type: "bytes" },
                        { name: "callData", type: "bytes" },
                        { name: "accountGasLimits", type: "bytes32" },
                        { name: "preVerificationGas", type: "uint256" },
                        { name: "gasFees", type: "bytes32" },
                        { name: "paymasterAndData", type: "bytes" },
                        { name: "signature", type: "bytes" }
                    ],
                    name: "userOperation",
                    type: "tuple"
                }
            ],
            [packedUserOp]
        )
    )
}

export function fillUserOpWithDummyData(userOp: UserOperation): UserOperation {
    if (isVersion06(userOp)) {
        return {
            ...userOp,
            callGasLimit: maxUint128,
            verificationGasLimit: maxUint128,
            preVerificationGas: maxUint256,
            maxFeePerGas: maxUint128,
            maxPriorityFeePerGas: maxUint128,
            paymasterAndData: bytesToHex(
                new Uint8Array(userOp.paymasterAndData.length).fill(255)
            ),
            signature: bytesToHex(
                new Uint8Array(userOp.signature.length).fill(255)
            )
        }
    }

    // For v0.7
    const hasPaymaster = !!userOp.paymaster
    return {
        ...userOp,
        callGasLimit: maxUint128,
        verificationGasLimit: maxUint128,
        preVerificationGas: maxUint256,
        maxFeePerGas: maxUint128,
        maxPriorityFeePerGas: maxUint128,
        ...(hasPaymaster && {
            paymasterVerificationGasLimit: maxUint128,
            paymasterPostOpGasLimit: maxUint128,
            paymasterData: bytesToHex(
                new Uint8Array(size(userOp.paymasterData || "0x")).fill(255)
            )
        }),
        signature: bytesToHex(new Uint8Array(size(userOp.signature)).fill(255))
    }
}
