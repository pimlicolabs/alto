import { EntryPointAbi, HexData32, UserOperation } from "@alto/types"
import { Address, PublicClient, decodeEventLog, encodeAbiParameters, keccak256 } from "viem"

export const transactionIncluded = async (
    txHash: HexData32,
    publicClient: PublicClient
): Promise<"included" | "reverted" | "failed" | "not_found"> => {
    try {
        const rcp = await publicClient.getTransactionReceipt({ hash: txHash })

        if (rcp.status === "success") {
            // find if any logs are UserOperationEvent
            const r = rcp.logs
                .map((l) => {
                    if (l.address === rcp.to) {
                        try {
                            const log = decodeEventLog({ abi: EntryPointAbi, data: l.data, topics: l.topics })
                            if (log.eventName === "UserOperationEvent") {
                                return log
                            } else {
                                return undefined
                            }
                        } catch (_e) {
                            console.log("error decoding transaction inclusion status", _e)
                            return undefined
                        }
                    } else {
                        return undefined
                    }
                })
                .find((l) => l !== undefined)

            if (r?.args.success) {
                return "included"
            } else {
                return "reverted"
            }
        } else {
            return "failed"
        }
    } catch (_e) {
        return "not_found"
    }
}

export const getUserOperationHash = (userOperation: UserOperation, entryPointAddress: Address, chainId: number) => {
    const hash = keccak256(
        encodeAbiParameters(
            [
                {
                    name: "sender",
                    type: "address"
                },
                {
                    name: "nonce",
                    type: "uint256"
                },
                {
                    name: "initCodeHash",
                    type: "bytes32"
                },
                {
                    name: "callDataHash",
                    type: "bytes32"
                },
                {
                    name: "callGasLimit",
                    type: "uint256"
                },
                {
                    name: "verificationGasLimit",
                    type: "uint256"
                },
                {
                    name: "preVerificationGas",
                    type: "uint256"
                },
                {
                    name: "maxFeePerGas",
                    type: "uint256"
                },
                {
                    name: "maxPriorityFeePerGas",
                    type: "uint256"
                },
                {
                    name: "paymasterAndDataHash",
                    type: "bytes32"
                }
            ],
            [
                userOperation.sender,
                userOperation.nonce,
                keccak256(userOperation.initCode),
                keccak256(userOperation.callData),
                userOperation.callGasLimit,
                userOperation.verificationGasLimit,
                userOperation.preVerificationGas,
                userOperation.maxFeePerGas,
                userOperation.maxPriorityFeePerGas,
                keccak256(userOperation.paymasterAndData)
            ]
        )
    )

    return keccak256(
        encodeAbiParameters(
            [
                {
                    name: "userOpHash",
                    type: "bytes32"
                },
                {
                    name: "entryPointAddress",
                    type: "address"
                },
                {
                    name: "chainId",
                    type: "uint256"
                }
            ],
            [hash, entryPointAddress, BigInt(chainId)]
        )
    )
}

export const getNonceKeyAndValue = (userOperation: UserOperation) => {
    const nonceKey = userOperation.nonce >> 64n // first 192 bits of nonce
    const userOperationNonceValue = userOperation.nonce & 0xffffffffffffffffn // last 64 bits of nonce

    return [nonceKey, userOperationNonceValue]
}

/*
 function pack(
        UserOperation calldata userOp
    ) internal pure returns (bytes memory ret) {
        address sender = getSender(userOp);
        uint256 nonce = userOp.nonce;
        bytes32 hashInitCode = calldataKeccak(userOp.initCode);
        bytes32 hashCallData = calldataKeccak(userOp.callData);
        uint256 callGasLimit = userOp.callGasLimit;
        uint256 verificationGasLimit = userOp.verificationGasLimit;
        uint256 preVerificationGas = userOp.preVerificationGas;
        uint256 maxFeePerGas = userOp.maxFeePerGas;
        uint256 maxPriorityFeePerGas = userOp.maxPriorityFeePerGas;
        bytes32 hashPaymasterAndData = calldataKeccak(userOp.paymasterAndData);

        return abi.encode(
            sender, nonce,
            hashInitCode, hashCallData,
            callGasLimit, verificationGasLimit, preVerificationGas,
            maxFeePerGas, maxPriorityFeePerGas,
            hashPaymasterAndData
        );
    }


    const encodedData = encodeAbiParameters(
  [
    { name: 'x', type: 'string' },
    { name: 'y', type: 'uint' },
    { name: 'z', type: 'bool' }
  ],
  ['wagmi', 420n, true]
)

*/
