import {
    type PackedUserOperation,
    type UserOperation,
    type UserOperation06,
    type UserOperation07,
    type UserOperationReceipt,
    logSchema,
    receiptSchema
} from "@alto/types"
import {
    type Address,
    type Hex,
    type PublicClient,
    type TransactionReceipt,
    concat,
    decodeEventLog,
    encodeAbiParameters,
    getAbiItem,
    getAddress,
    keccak256,
    pad,
    size,
    slice,
    toHex,
    zeroAddress
} from "viem"
import { entryPoint07Abi } from "viem/account-abstraction"
import { z } from "zod"
import { getAuthorizationStateOverrides } from "./helpers"

// Type predicate check if the UserOperation is V06.
export function isVersion06(
    operation: UserOperation
): operation is UserOperation06 {
    return "initCode" in operation && "paymasterAndData" in operation
}

// Type predicate to check if the UserOperation is V07.
export function isVersion07(
    operation: UserOperation
): operation is UserOperation07 {
    return "factory" in operation && "paymaster" in operation
}

// Type predicate to check if the UserOperation is V07.
export function isVersion08(
    operation: UserOperation,
    entryPointAddress: Address
): operation is UserOperation07 {
    return entryPointAddress.startsWith("0x4337")
}

export function getInitCode(unpackedUserOp: UserOperation07) {
    return unpackedUserOp.factory
        ? concat([
              unpackedUserOp.factory === "0x7702"
                  ? pad(unpackedUserOp.factory, {
                        dir: "right",
                        size: 20
                    })
                  : unpackedUserOp.factory,
              unpackedUserOp.factoryData || ("0x" as Hex)
          ])
        : "0x"
}

export function unPackInitCode(initCode: Hex) {
    if (initCode === "0x") {
        return {
            factory: null,
            factoryData: null
        }
    }

    return {
        factory: getAddress(slice(initCode, 0, 20)),
        factoryData: size(initCode) > 20 ? slice(initCode, 20) : null
    }
}

export function getAccountGasLimits(unpackedUserOp: UserOperation07) {
    return concat([
        pad(toHex(unpackedUserOp.verificationGasLimit), {
            size: 16
        }),
        pad(toHex(unpackedUserOp.callGasLimit), { size: 16 })
    ])
}

export function unpackAccountGasLimits(accountGasLimits: Hex) {
    return {
        verificationGasLimit: BigInt(slice(accountGasLimits, 0, 16)),
        callGasLimit: BigInt(slice(accountGasLimits, 16))
    }
}

export function getGasLimits(unpackedUserOp: UserOperation07) {
    return concat([
        pad(toHex(unpackedUserOp.maxPriorityFeePerGas), {
            size: 16
        }),
        pad(toHex(unpackedUserOp.maxFeePerGas), { size: 16 })
    ])
}

export function unpackGasLimits(gasLimits: Hex) {
    return {
        maxPriorityFeePerGas: BigInt(slice(gasLimits, 0, 16)),
        maxFeePerGas: BigInt(slice(gasLimits, 16))
    }
}

export function getPaymasterAndData(unpackedUserOp: UserOperation07) {
    return unpackedUserOp.paymaster
        ? concat([
              unpackedUserOp.paymaster,
              pad(toHex(unpackedUserOp.paymasterVerificationGasLimit || 0n), {
                  size: 16
              }),
              pad(toHex(unpackedUserOp.paymasterPostOpGasLimit || 0n), {
                  size: 16
              }),
              unpackedUserOp.paymasterData || ("0x" as Hex)
          ])
        : "0x"
}

export function unpackPaymasterAndData(paymasterAndData: Hex) {
    if (paymasterAndData === "0x") {
        return {
            paymaster: null,
            paymasterVerificationGasLimit: null,
            paymasterPostOpGasLimit: null,
            paymasterData: null
        }
    }

    const paymasterAndDataSize = size(paymasterAndData)

    return {
        paymaster: getAddress(slice(paymasterAndData, 0, 20)),
        paymasterVerificationGasLimit: BigInt(slice(paymasterAndData, 20, 36)),
        paymasterPostOpGasLimit: BigInt(slice(paymasterAndData, 36, 52)),
        paymasterData:
            paymasterAndDataSize > 52 ? slice(paymasterAndData, 52) : null
    }
}

export function toPackedUserOp(
    unpackedUserOp: UserOperation07
): PackedUserOperation {
    return {
        sender: unpackedUserOp.sender,
        nonce: unpackedUserOp.nonce,
        initCode: getInitCode(unpackedUserOp),
        callData: unpackedUserOp.callData,
        accountGasLimits: getAccountGasLimits(unpackedUserOp),
        preVerificationGas: unpackedUserOp.preVerificationGas,
        gasFees: getGasLimits(unpackedUserOp),
        paymasterAndData: getPaymasterAndData(unpackedUserOp),
        signature: unpackedUserOp.signature
    }
}

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
): Address | null {
    if (!data) {
        return null
    }
    if (data.length >= 42) {
        return getAddress(data.slice(0, 42))
    }
    return null
}

export const getUserOpHashV06 = ({
    userOp,
    entryPointAddress,
    chainId
}: {
    userOp: UserOperation06
    entryPointAddress: Address
    chainId: number
}) => {
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
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.callGasLimit,
                userOp.verificationGasLimit,
                userOp.preVerificationGas,
                userOp.maxFeePerGas,
                userOp.maxPriorityFeePerGas,
                keccak256(userOp.paymasterAndData)
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

export const getUserOpHashV07 = ({
    userOp,
    entryPointAddress,
    chainId
}: {
    userOp: PackedUserOperation
    entryPointAddress: Address
    chainId: number
}) => {
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
                    name: "accountGasLimits",
                    type: "bytes32"
                },
                {
                    name: "preVerificationGas",
                    type: "uint256"
                },
                {
                    name: "gasFees",
                    type: "bytes32"
                },
                {
                    name: "paymasterAndDataHash",
                    type: "bytes32"
                }
            ],
            [
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                keccak256(userOp.paymasterAndData)
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

export const getUserOpHashV08 = async ({
    userOp,
    entryPointAddress,
    publicClient
}: {
    userOp: UserOperation07
    entryPointAddress: Address
    chainId: number
    publicClient: PublicClient
}) => {
    const packedUserOp = toPackedUserOp(userOp)

    // : concat(["0xef0100", code ?? "0x"])
    const stateOverrides = getAuthorizationStateOverrides({
        userOps: [userOp]
    })

    const hash = await publicClient.readContract({
        address: entryPointAddress,
        abi: [
            {
                inputs: [
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
                        name: "userOp",
                        type: "tuple"
                    }
                ],
                name: "getUserOpHash",
                outputs: [{ name: "", type: "bytes32" }],
                stateMutability: "view",
                type: "function"
            }
        ],
        functionName: "getUserOpHash",
        args: [packedUserOp],
        stateOverride: [
            ...Object.keys(stateOverrides).map((address) => ({
                address: address as Address,
                code: stateOverrides[address as Address]?.code ?? "0x"
            }))
        ]
    })

    return hash
}

export const getUserOpHash = ({
    userOp,
    entryPointAddress,
    chainId,
    publicClient
}: {
    userOp: UserOperation
    entryPointAddress: Address
    chainId: number
    publicClient: PublicClient
}) => {
    if (isVersion06(userOp)) {
        return getUserOpHashV06({
            userOp,
            entryPointAddress,
            chainId
        })
    }

    if (isVersion08(userOp, entryPointAddress)) {
        return getUserOpHashV08({
            userOp,
            entryPointAddress,
            chainId,
            publicClient
        })
    }

    return getUserOpHashV07({
        userOp: toPackedUserOp(userOp),
        entryPointAddress,
        chainId
    })
}

export const getNonceKeyAndSequence = (nonce: bigint) => {
    const nonceKey = nonce >> 64n // first 192 bits of nonce
    const nonceSequence = nonce & 0xffffffffffffffffn // last 64 bits of nonce

    return [nonceKey, nonceSequence]
}

export function toUnpackedUserOp(
    packedUserOp: PackedUserOperation
): UserOperation07 {
    const { factory, factoryData } = unPackInitCode(packedUserOp.initCode)

    const { callGasLimit, verificationGasLimit } = unpackAccountGasLimits(
        packedUserOp.accountGasLimits
    )

    const { maxFeePerGas, maxPriorityFeePerGas } = unpackGasLimits(
        packedUserOp.gasFees
    )

    const {
        paymaster,
        paymasterVerificationGasLimit,
        paymasterPostOpGasLimit,
        paymasterData
    } = unpackPaymasterAndData(packedUserOp.paymasterAndData)

    return {
        sender: packedUserOp.sender,
        nonce: packedUserOp.nonce,
        factory: factory,
        factoryData: factoryData,
        callData: packedUserOp.callData,
        callGasLimit: callGasLimit,
        verificationGasLimit: verificationGasLimit,
        preVerificationGas: packedUserOp.preVerificationGas,
        maxFeePerGas: maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        paymaster: paymaster,
        paymasterVerificationGasLimit: paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: paymasterPostOpGasLimit,
        paymasterData: paymasterData,
        signature: packedUserOp.signature
    }
}

export function parseUserOpReceipt(
    userOpHash: Hex,
    receipt: TransactionReceipt
) {
    let entryPoint: Address = zeroAddress
    let revertReason: Hex | undefined
    let userOpEventArgs:
        | {
              userOpHash: Hex
              sender: Address
              paymaster: Address
              nonce: bigint
              success: boolean
              actualGasCost: bigint
              actualGasUsed: bigint
          }
        | undefined

    let startIndex = -1
    let userOpEventIndex = -1

    // Find our UserOpEvent and determine the starting point for logs
    for (let index = 0; index < receipt.logs.length; index++) {
        const log = receipt.logs[index]
        try {
            const { eventName, args } = decodeEventLog({
                abi: [
                    getAbiItem({
                        abi: entryPoint07Abi,
                        name: "UserOperationEvent"
                    }),
                    getAbiItem({
                        abi: entryPoint07Abi,
                        name: "UserOperationRevertReason"
                    }),
                    getAbiItem({
                        abi: entryPoint07Abi,
                        name: "BeforeExecution"
                    })
                ],
                data: log.data,
                topics: log.topics
            })

            if (eventName === "BeforeExecution") {
                // BeforeExecution is emitted once and before individually executing UserOperations.
                startIndex = index
            }

            if (
                eventName === "UserOperationRevertReason" &&
                args.userOpHash === userOpHash
            ) {
                revertReason = args.revertReason
            }

            if (eventName === "UserOperationEvent") {
                if (args.userOpHash === userOpHash) {
                    userOpEventIndex = index
                    entryPoint = log.address
                    userOpEventArgs = args
                    break
                }
                // Update startIndex to this UserOpEvent for the next UserOp's logs
                startIndex = index
            }
        } catch (e) {}
    }

    if (userOpEventIndex === -1 || startIndex === -1 || !userOpEventArgs) {
        throw new Error("fatal: no UserOpEvent in logs")
    }

    // Get logs between the starting point and our UserOpEvent
    const filteredLogs = receipt.logs.slice(startIndex + 1, userOpEventIndex)
    const parsedLogs = z.array(logSchema).parse(filteredLogs)
    const parsedReceipt = receiptSchema.parse({
        ...receipt,
        status: receipt.status === "success" ? 1 : 0
    })

    let paymaster: Address | undefined = userOpEventArgs.paymaster
    if (paymaster === zeroAddress) {
        paymaster = undefined
    }

    const userOpReceipt: UserOperationReceipt = {
        userOpHash,
        entryPoint,
        paymaster,
        sender: userOpEventArgs.sender,
        nonce: userOpEventArgs.nonce,
        actualGasUsed: userOpEventArgs.actualGasUsed,
        actualGasCost: userOpEventArgs.actualGasCost,
        success: userOpEventArgs.success,
        reason: revertReason,
        logs: parsedLogs,
        receipt: parsedReceipt
    }

    return userOpReceipt
}
