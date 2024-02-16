import {
    EntryPointAbi,
    type HexData32,
    type UserOperation
} from "@entrypoint-0.6/types"
import * as sentry from "@sentry/node"
import {
    type Address,
    type Hex,
    type PublicClient,
    decodeEventLog,
    encodeAbiParameters,
    getAddress,
    keccak256,
    toHex
} from "viem"
import { areAddressesEqual } from "./helpers"

// biome-ignore lint/suspicious/noExplicitAny: it's a generic type
export function deepHexlify(obj: any): any {
    if (typeof obj === "function") {
        return undefined
    }
    if (obj == null || typeof obj === "string" || typeof obj === "boolean") {
        return obj
    }

    if (typeof obj === "bigint") {
        return toHex(obj)
    }

    if (obj._isBigNumber != null || typeof obj !== "object") {
        return toHex(obj).replace(/^0x0/, "0x")
    }
    if (Array.isArray(obj)) {
        return obj.map((member) => deepHexlify(member))
    }
    return Object.keys(obj).reduce(
        // biome-ignore lint/suspicious/noExplicitAny: it's a recursive function, so it's hard to type
        (set: any, key: string) => {
            set[key] = deepHexlify(obj[key])
            return set
        },
        {}
    )
}

export function getAddressFromInitCodeOrPaymasterAndData(
    data: Hex
): Address | undefined {
    if (!data) {
        return undefined
    }
    if (data.length >= 42) {
        return getAddress(data.slice(0, 42))
    }
    return undefined
}

export const transactionIncluded = async (
    txHash: HexData32,
    publicClient: PublicClient,
    entryPoint: Address
): Promise<{
    status: "included" | "reverted" | "failed" | "not_found"
    [userOperationHash: HexData32]: {
        accountDeployed: boolean
    }
}> => {
    try {
        const rcp = await publicClient.getTransactionReceipt({ hash: txHash })

        if (rcp.status === "success") {
            // find if any logs are UserOperationEvent or AccountDeployed
            const r = rcp.logs
                .map((l) => {
                    if (areAddressesEqual(l.address, entryPoint)) {
                        try {
                            const log = decodeEventLog({
                                abi: EntryPointAbi,
                                data: l.data,
                                topics: l.topics
                            })
                            if (log.eventName === "AccountDeployed") {
                                return {
                                    userOperationHash: log.args.userOpHash,
                                    success: !!log.args.factory,
                                    accountDeployed: true
                                }
                            }
                            if (log.eventName === "UserOperationEvent") {
                                return {
                                    userOperationHash: log.args.userOpHash,
                                    success: !!log.args.success,
                                    accountDeployed: false
                                }
                            }
                            return undefined
                        } catch (_e) {
                            sentry.captureException(_e)
                            return undefined
                        }
                    }
                    return undefined
                })
                .reduce(
                    (
                        result: {
                            [userOperationHash: HexData32]: {
                                userOperationHash: HexData32
                                accountDeployed: boolean
                                success: boolean
                            }
                        },
                        log
                    ) => {
                        if (log) {
                            result[log.userOperationHash] = {
                                userOperationHash: log.userOperationHash,
                                accountDeployed:
                                    log.accountDeployed ||
                                    result[log.userOperationHash]
                                        ?.accountDeployed,
                                success:
                                    log.success ||
                                    result[log.userOperationHash]?.success
                            }

                            return result
                        }
                        return result
                    },
                    {}
                )

            const success = Object.values(r).reduce(
                (x, v) => x || v.success,
                false
            )

            if (success) {
                return {
                    status: "included",
                    ...r
                }
            }
            return {
                status: "reverted"
            }
        }
        return {
            status: "failed"
        }
    } catch (_e) {
        return {
            status: "not_found"
        }
    }
}

export const getUserOperationHash = (
    userOperation: UserOperation,
    entryPointAddress: Address,
    chainId: number
) => {
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

export const getNonceKeyAndValue = (nonce: bigint) => {
    const nonceKey = nonce >> 64n // first 192 bits of nonce
    const userOperationNonceValue = nonce & 0xffffffffffffffffn // last 64 bits of nonce

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
