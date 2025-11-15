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
    type TransactionReceipt,
    concat,
    decodeEventLog,
    getAbiItem,
    getAddress,
    pad,
    size,
    slice,
    toHex,
    zeroAddress
} from "viem"
import { entryPoint07Abi, getUserOperationHash } from "viem/account-abstraction"
import { z } from "zod"
import { getEip7702AuthAddress } from "./eip7702"

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

// Check if a userOperation is a deployment operation
export function isDeployment(userOp: UserOperation): boolean {
    const isV6Deployment =
        isVersion06(userOp) && !!userOp.initCode && userOp.initCode !== "0x"
    const isV7Deployment =
        isVersion07(userOp) && !!userOp.factory && userOp.factory !== "0x"
    return isV6Deployment || isV7Deployment
}

function getInitCode(unpackedUserOp: UserOperation07) {
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

function unPackInitCode(initCode: Hex) {
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

function getAccountGasLimits(unpackedUserOp: UserOperation07) {
    return concat([
        pad(toHex(unpackedUserOp.verificationGasLimit), {
            size: 16
        }),
        pad(toHex(unpackedUserOp.callGasLimit), { size: 16 })
    ])
}

function unpackAccountGasLimits(accountGasLimits: Hex) {
    return {
        verificationGasLimit: BigInt(slice(accountGasLimits, 0, 16)),
        callGasLimit: BigInt(slice(accountGasLimits, 16))
    }
}

function getGasLimits(unpackedUserOp: UserOperation07) {
    return concat([
        pad(toHex(unpackedUserOp.maxPriorityFeePerGas), {
            size: 16
        }),
        pad(toHex(unpackedUserOp.maxFeePerGas), { size: 16 })
    ])
}

function unpackGasLimits(gasLimits: Hex) {
    return {
        maxPriorityFeePerGas: BigInt(slice(gasLimits, 0, 16)),
        maxFeePerGas: BigInt(slice(gasLimits, 16))
    }
}

function getPaymasterAndData(unpackedUserOp: UserOperation07) {
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

function unpackPaymasterAndData(paymasterAndData: Hex) {
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

export function getUserOpHash({
    userOp,
    entryPointAddress,
    chainId
}: {
    userOp: UserOperation
    entryPointAddress: Address
    chainId: number
}): Hex {
    if (isVersion08(userOp, entryPointAddress)) {
        const authorization = userOp.eip7702Auth
            ? {
                  address: getEip7702AuthAddress(userOp.eip7702Auth),
                  chainId: userOp.eip7702Auth.chainId,
                  nonce: userOp.eip7702Auth.nonce,
                  r: userOp.eip7702Auth.r,
                  s: userOp.eip7702Auth.s,
                  yParity: userOp.eip7702Auth.yParity,
                  v: userOp.eip7702Auth.v
              }
            : undefined

        return getUserOperationHash({
            chainId,
            entryPointAddress,
            entryPointVersion: "0.8",
            userOperation: {
                ...userOp,
                paymaster: userOp.paymaster ?? undefined,
                paymasterData: userOp.paymasterData ?? undefined,
                paymasterVerificationGasLimit:
                    userOp.paymasterVerificationGasLimit ?? undefined,
                paymasterPostOpGasLimit:
                    userOp.paymasterPostOpGasLimit ?? undefined,
                factory: userOp.factory ?? undefined,
                factoryData: userOp.factoryData ?? undefined,
                authorization
            }
        })
    }

    if (isVersion07(userOp)) {
        return getUserOperationHash({
            chainId,
            entryPointAddress,
            entryPointVersion: "0.7",
            userOperation: {
                ...userOp,
                paymaster: userOp.paymaster ?? undefined,
                paymasterData: userOp.paymasterData ?? undefined,
                paymasterPostOpGasLimit:
                    userOp.paymasterPostOpGasLimit ?? undefined,
                paymasterVerificationGasLimit:
                    userOp.paymasterVerificationGasLimit ?? undefined,
                factory: userOp.factory ?? undefined,
                factoryData: userOp.factoryData ?? undefined
            }
        })
    }

    return getUserOperationHash({
        chainId,
        entryPointAddress,
        entryPointVersion: "0.6",
        userOperation: userOp
    })
}

export const getNonceKeyAndSequence = (nonce: bigint) => {
    const nonceKey = nonce >> 64n // first 192 bits of nonce
    const nonceSequence = nonce & 0xffffffffffffffffn // last 64 bits of nonce

    return [nonceKey, nonceSequence]
}

// Check if a userOperation has a paymaster
export function hasPaymaster(userOp: UserOperation): boolean {
    if (isVersion06(userOp)) {
        return !!userOp.paymasterAndData && userOp.paymasterAndData !== "0x"
    }
    return !!userOp.paymaster && userOp.paymaster !== "0x"
}

export function calculateRequiredPrefund(userOp: UserOperation): bigint {
    if (isVersion06(userOp)) {
        const mul = hasPaymaster(userOp) ? 3n : 1n
        const requiredGas =
            userOp.callGasLimit +
            userOp.verificationGasLimit * mul +
            userOp.preVerificationGas

        return requiredGas * userOp.maxFeePerGas
    }

    // v0.7/v0.8 logic: sum all gas limits directly
    const paymasterVerificationGasLimit =
        userOp.paymasterVerificationGasLimit ?? 0n
    const paymasterPostOpGasLimit = userOp.paymasterPostOpGasLimit ?? 0n

    const requiredGas =
        userOp.verificationGasLimit +
        userOp.callGasLimit +
        paymasterVerificationGasLimit +
        paymasterPostOpGasLimit +
        userOp.preVerificationGas

    return requiredGas * userOp.maxFeePerGas
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
        } catch {}
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
