import {
    type PackedUserOperation,
    type UserOperation,
    type UserOperation06,
    type UserOperation07,
    type UserOperationReceipt,
    logSchema,
    receiptSchema
} from "@alto/types"
import { UserOperation as UserOperationUtils } from "ox/erc4337"
import {
    type Address,
    type Hex,
    type PublicClient,
    type TransactionReceipt,
    decodeEventLog,
    getAbiItem,
    getAddress,
    toHex,
    zeroAddress
} from "viem"
import {
    entryPoint07Abi,
    getUserOperationHash,
    toPackedUserOperation
} from "viem/account-abstraction"
import { z } from "zod"

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

export function toPackedUserOp(
    unpackedUserOp: UserOperation07
): PackedUserOperation {
    return toPackedUserOperation({
        ...unpackedUserOp,
        factory: unpackedUserOp.factory ?? undefined,
        factoryData: unpackedUserOp.factoryData ?? undefined,
        paymaster: unpackedUserOp.paymaster ?? undefined,
        paymasterData: unpackedUserOp.paymasterData ?? undefined,
        paymasterVerificationGasLimit:
            unpackedUserOp.paymasterVerificationGasLimit ?? undefined,
        paymasterPostOpGasLimit:
            unpackedUserOp.paymasterPostOpGasLimit ?? undefined
    })
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
    if (isVersion08(userOp, entryPointAddress)) {
        return getUserOperationHash({
            userOperation: {
                ...userOp,
                factory: userOp.factory ?? undefined,
                factoryData: userOp.factoryData ?? undefined,
                paymaster: userOp.paymaster ?? undefined,
                paymasterData: userOp.paymasterData ?? undefined,
                paymasterVerificationGasLimit:
                    userOp.paymasterVerificationGasLimit ?? undefined,
                paymasterPostOpGasLimit:
                    userOp.paymasterPostOpGasLimit ?? undefined
            },
            entryPointAddress,
            entryPointVersion: "0.8",
            chainId
        })
    }

    if (isVersion07(userOp)) {
        return getUserOperationHash({
            userOperation: {
                ...userOp,
                factory: userOp.factory ?? undefined,
                factoryData: userOp.factoryData ?? undefined,
                paymaster: userOp.paymaster ?? undefined,
                paymasterData: userOp.paymasterData ?? undefined,
                paymasterVerificationGasLimit:
                    userOp.paymasterVerificationGasLimit ?? undefined,
                paymasterPostOpGasLimit:
                    userOp.paymasterPostOpGasLimit ?? undefined
            },
            entryPointAddress,
            entryPointVersion: "0.7",
            chainId
        })
    }

    return getUserOperationHash({
        userOperation: userOp,
        entryPointAddress,
        entryPointVersion: "0.6",
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
    const unpacked = UserOperationUtils.fromPacked(packedUserOp)
    return {
        ...unpacked,
        factory: unpacked.factory ?? null,
        factoryData: unpacked.factoryData ?? null,
        paymaster: unpacked.paymaster ?? null,
        paymasterData: unpacked.paymasterData ?? null,
        paymasterVerificationGasLimit:
            unpacked.paymasterVerificationGasLimit ?? null,
        paymasterPostOpGasLimit: unpacked.paymasterPostOpGasLimit ?? null
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
