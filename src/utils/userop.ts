import {
    type PackedUserOperation,
    type UserOperation,
    type UserOperation06,
    type UserOperation07,
    type UserOperation08,
    type UserOperation09,
    type UserOperationReceipt,
    logSchema,
    receiptSchema
} from "@alto/types"
import {
    type Address,
    type Hex,
    type TransactionReceipt,
    decodeEventLog,
    getAbiItem,
    getAddress,
    size,
    slice,
    toHex,
    zeroAddress
} from "viem"
import {
    type EntryPointVersion,
    entryPoint07Abi,
    getUserOperationHash,
    toPackedUserOperation
} from "viem/account-abstraction"
import { z } from "zod"
import type { AltoConfig } from "../createConfig"
import { getEip7702AuthAddress } from "./eip7702"

// Type predicate check if the UserOperation is v0.6
export function isVersion06(
    operation: UserOperation
): operation is UserOperation06 {
    return "initCode" in operation && "paymasterAndData" in operation
}

// Type predicate to check if the UserOperation is v0.7
export function isVersion07(
    operation: UserOperation
): operation is UserOperation07 {
    return "factory" in operation && "paymaster" in operation
}

// Type predicate to check if the UserOperation is v0.8
export function isVersion08(
    operation: UserOperation,
    entryPointAddress: Address
): operation is UserOperation07 {
    return entryPointAddress.startsWith("0x433708")
}

// Type predicate to check if the UserOperation is v0.9
export function isVersion09(
    operation: UserOperation,
    entryPointAddress: Address
): operation is UserOperation07 {
    return entryPointAddress.startsWith("0x433709")
}

// Validates that EntryPoint 0.9 userOps don't include PAYMASTER_SIG_MAGIC (should be included in userOp.paymasterSignature rather than userOp.paymasterData)
export function validatePaymasterSignature(
    userOp: UserOperation,
    entryPointAddress: Address
): string | null {
    if (!isVersion09(userOp, entryPointAddress)) {
        return null
    }

    const paymasterData = userOp.paymasterData
    if (!paymasterData || paymasterData === "0x") {
        return null
    }

    // Magic bytes indicating paymaster signature data should follow
    // See: https://docs.erc4337.io/paymasters/paymaster-signature.html
    const paymasterSigMagic: Hex = "0x22e325a297439656"
    const magicSize = size(paymasterSigMagic) // 8 bytes
    const dataSize = size(paymasterData)

    if (dataSize < magicSize) {
        return null
    }

    // Get the last 8 bytes and compare with magic
    const lastBytes = slice(paymasterData, dataSize - magicSize)
    if (lastBytes === paymasterSigMagic) {
        return "paymasterData contains signature placeholder (PAYMASTER_SIG_MAGIC) but is missing the actual signature. The paymaster signature must be appended after the magic bytes. See https://docs.erc4337.io/paymasters/paymaster-signature.html"
    }

    return null
}

// Check if a userOperation is a deployment operation
export function isDeployment(userOp: UserOperation): boolean {
    const isDeployment06 =
        isVersion06(userOp) && !!userOp.initCode && userOp.initCode !== "0x"
    const isDeployment07 =
        isVersion07(userOp) && !!userOp.factory && userOp.factory !== "0x"
    return isDeployment06 || isDeployment07
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

function unpackAccountGasLimits(accountGasLimits: Hex) {
    return {
        verificationGasLimit: BigInt(slice(accountGasLimits, 0, 16)),
        callGasLimit: BigInt(slice(accountGasLimits, 16))
    }
}

function unpackGasLimits(gasLimits: Hex) {
    return {
        maxPriorityFeePerGas: BigInt(slice(gasLimits, 0, 16)),
        maxFeePerGas: BigInt(slice(gasLimits, 16))
    }
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

// Convert Alto's UserOperation07/08/09 (with null) to viem's format (with undefined)
export function toViemUserOp(
    userOp: UserOperation07 | UserOperation08 | UserOperation09
) {
    const base = {
        ...userOp,
        paymaster: userOp.paymaster ?? undefined,
        paymasterData: userOp.paymasterData ?? undefined,
        paymasterVerificationGasLimit:
            userOp.paymasterVerificationGasLimit ?? undefined,
        paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit ?? undefined,
        factory: userOp.factory ?? undefined,
        factoryData: userOp.factoryData ?? undefined
    }

    // UserOperation09 has paymasterSignature field
    if ("paymasterSignature" in userOp) {
        return {
            ...base,
            paymasterSignature: userOp.paymasterSignature ?? undefined
        }
    }

    return base
}

export function toPackedUserOp(
    unpacked: UserOperation07 | UserOperation08 | UserOperation09
): PackedUserOperation {
    return toPackedUserOperation(toViemUserOp(unpacked))
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
    if (isVersion09(userOp, entryPointAddress)) {
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
            entryPointVersion: "0.9",
            userOperation: {
                ...toViemUserOp(userOp),
                authorization
            }
        })
    }

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
                ...toViemUserOp(userOp),
                authorization
            }
        })
    }

    if (isVersion07(userOp)) {
        return getUserOperationHash({
            chainId,
            entryPointAddress,
            entryPointVersion: "0.7",
            userOperation: toViemUserOp(userOp)
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
        throw new Error(
            `fatal: no UserOpEvent in logs, ${userOpEventIndex} ${startIndex} ${userOpEventArgs}`
        )
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

export const getViemEntryPointVersion = (
    userOp: UserOperation,
    entryPoint: Address
): EntryPointVersion => {
    if (isVersion09(userOp, entryPoint)) {
        return "0.9"
    }

    if (isVersion08(userOp, entryPoint)) {
        return "0.8"
    }

    if (isVersion07(userOp)) {
        return "0.7"
    }

    return "0.6"
}

export const getEntryPointSimulationsAddress = ({
    version,
    config
}: {
    version: EntryPointVersion
    config: AltoConfig
}): Address | undefined => {
    switch (version) {
        case "0.9":
            return config.entrypointSimulationContractV9
        case "0.8":
            return config.entrypointSimulationContractV8
        default:
            return config.entrypointSimulationContractV7
    }
}
