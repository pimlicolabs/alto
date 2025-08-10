import { type Hex, decodeErrorResult } from "viem"
import { z } from "zod"
import { RpcError } from "."
import { EntryPointV06Abi } from "./contracts"
import { type HexData, addressSchema } from "./schemas"

export type StakeInfo = {
    addr?: string
    stake: bigint
    unstakeDelaySec: bigint
}

type SlotMap = {
    [slot: string]: string
}

export type StorageMap = {
    [address: string]: string | SlotMap
}

// hexnum regex
const hexPattern = /^0x[0-9a-f]*$/

const signatureValidationFailedSchema = z
    .tuple([addressSchema])
    .transform((val) => {
        return { aggregator: val[0] }
    })

const signatureValidationFailedErrorSchema = z.object({
    args: signatureValidationFailedSchema,
    errorName: z.literal("SignatureValidationFailed")
})

const senderAddressResultSchema = z.tuple([addressSchema]).transform((val) => {
    return {
        sender: val[0]
    }
})

const senderAddressResultErrorSchema = z.object({
    args: senderAddressResultSchema,
    errorName: z.literal("SenderAddressResult")
})

const failedOpSchema = z.tuple([z.bigint(), z.string()]).transform((val) => {
    return { opIndex: val[0], reason: val[1] }
})

export type FailedOp = z.infer<typeof failedOpSchema>

const failedOpErrorSchema = z.object({
    args: failedOpSchema,
    errorName: z.literal("FailedOp")
})

const failedOpWithRevertSchema = z
    .tuple([z.bigint(), z.string(), z.string()])
    .transform((val) => {
        return { opIndex: val[0], reason: val[1], inner: val[2] }
    })

export type FailedOpWithRevert = z.infer<typeof failedOpWithRevertSchema>

const executionResultSchema06 = z
    .tuple([
        z.bigint(),
        z.bigint(),
        z.number(),
        z.number(),
        z.boolean(),
        z.string().regex(hexPattern)
    ])
    .transform((val) => {
        return {
            preOpGas: val[0],
            paid: val[1],
            validAfter: val[2],
            validUntil: val[3],
            targetSuccess: val[4],
            targetResult: val[5] as HexData
        }
    })

const executionResultSchema07 = z
    .tuple([
        z.bigint(),
        z.bigint(),
        z.bigint(),
        z.bigint(),
        z.bigint(),
        z.bigint(),
        z.boolean(),
        z.string().regex(hexPattern)
    ])
    .transform((val) => {
        return {
            preOpGas: val[0],
            paid: val[1],
            accountValidationData: val[2],
            paymasterValidationData: val[3],
            paymasterVerificationGasLimit: val[4],
            paymasterPostOpGasLimit: val[5],
            targetSuccess: val[6],
            targetResult: val[7] as HexData
        }
    })

export const executionResultSchema = z.union([
    executionResultSchema06,
    executionResultSchema07
])

export type ExecutionResult = z.infer<typeof executionResultSchema>

const executionResultErrorSchema = z.object({
    args: executionResultSchema,
    errorName: z.literal("ExecutionResult")
})

const stakeInfoSchema = z.object({
    addr: z.string().optional(),
    stake: z.bigint(),
    unstakeDelaySec: z.bigint()
})

const validationResultSchema06 = z
    .union([
        // Without aggregation - 4 element tuple
        z.tuple([
            z.object({
                preOpGas: z.bigint(),
                prefund: z.bigint(),
                sigFailed: z.boolean(),
                validAfter: z.number(),
                validUntil: z.number(),
                paymasterContext: z
                    .string()
                    .regex(hexPattern)
                    .transform((val) => val as HexData)
            }),
            stakeInfoSchema,
            stakeInfoSchema.optional(),
            stakeInfoSchema.optional()
        ]),
        // With aggregation - 5 element tuple
        z.tuple([
            z.object({
                preOpGas: z.bigint(),
                prefund: z.bigint(),
                sigFailed: z.boolean(),
                validAfter: z.number(),
                validUntil: z.number(),
                paymasterContext: z
                    .string()
                    .regex(hexPattern)
                    .transform((val) => val as HexData)
            }),
            stakeInfoSchema,
            stakeInfoSchema.optional(),
            stakeInfoSchema.optional(),
            z.object({
                aggregator: addressSchema,
                stakeInfo: stakeInfoSchema
            })
        ])
    ])
    .transform((val) => ({
        returnInfo: val[0],
        senderInfo: val[1],
        factoryInfo: val[2],
        paymasterInfo: val[3],
        aggregatorInfo: val[4]
    }))

const validationResultSchema07 = z
    .union([
        // Without aggregation - 4 element tuple
        z.tuple([
            z.object({
                preOpGas: z.bigint(),
                prefund: z.bigint(),
                accountValidationData: z.bigint(),
                paymasterValidationData: z.bigint(),
                accountSigFailed: z.boolean().optional(),
                paymasterSigFailed: z.boolean().optional(),
                validAfter: z.number().optional(),
                validUntil: z.number().optional(),
                paymasterContext: z
                    .string()
                    .regex(hexPattern)
                    .transform((val) => val as HexData)
            }),
            stakeInfoSchema,
            stakeInfoSchema.optional(),
            stakeInfoSchema.optional()
        ]),
        // With aggregation - 5 element tuple
        z.tuple([
            z.object({
                preOpGas: z.bigint(),
                prefund: z.bigint(),
                accountValidationData: z.bigint(),
                paymasterValidationData: z.bigint(),
                accountSigFailed: z.boolean().optional(),
                paymasterSigFailed: z.boolean().optional(),
                validAfter: z.number().optional(),
                validUntil: z.number().optional(),
                paymasterContext: z
                    .string()
                    .regex(hexPattern)
                    .transform((val) => val as HexData)
            }),
            stakeInfoSchema,
            stakeInfoSchema.optional(),
            stakeInfoSchema.optional(),
            z.object({
                aggregator: addressSchema,
                stakeInfo: stakeInfoSchema
            })
        ])
    ])
    .transform((val) => ({
        returnInfo: val[0],
        senderInfo: val[1],
        factoryInfo: val[2],
        paymasterInfo: val[3],
        aggregatorInfo: val[4]
    }))

export const validationResultSchema = z.union([
    validationResultSchema06,
    validationResultSchema07
])

export type ValidationResult06 = z.infer<typeof validationResultSchema06>
export type ValidationResult07 = z.infer<typeof validationResultSchema07>

export type ValidationResult = z.infer<typeof validationResultSchema>

const validationResultErrorSchema = z.object({
    args: validationResultSchema,
    errorName: z.literal("ValidationResult")
})

const validationResultWithAggregationErrorSchema = z.object({
    args: validationResultSchema,
    errorName: z.literal("ValidationResultWithAggregation")
})

const entryPointErrorsSchema = z.discriminatedUnion("errorName", [
    validationResultErrorSchema,
    executionResultErrorSchema,
    failedOpErrorSchema,
    senderAddressResultErrorSchema,
    signatureValidationFailedErrorSchema,
    validationResultWithAggregationErrorSchema
])

const errorCauseSchema = z.object({
    name: z.literal("ContractFunctionRevertedError"),
    data: entryPointErrorsSchema
})

const vmExecutionError = z.object({
    name: z.literal("CallExecutionError"),
    cause: z.object({
        name: z.literal("RpcRequestError"),
        cause: z.object({
            data: z.string().transform((val) => {
                const hexStringRegex = /0x([a-fA-F0-9]+)?/
                const match = val.match(hexStringRegex)
                if (!match) {
                    throw new RpcError(
                        `User operation reverted on-chain with unknown error (some chains don't return revert reason) ${val}`
                    )
                }

                const errorHexData = match[0] as Hex
                if (errorHexData === "0x") {
                    throw new RpcError(
                        `User operation reverted on-chain with unknown error (some chains don't return revert reason) ${val}`
                    )
                }

                const errorResult = decodeErrorResult({
                    abi: EntryPointV06Abi,
                    data: errorHexData
                })
                return entryPointErrorsSchema.parse(errorResult)
            })
        })
    })
})

export const entryPointExecutionErrorSchema06 = z
    .object({
        name: z.literal("ContractFunctionExecutionError"),
        cause: z.discriminatedUnion("name", [
            errorCauseSchema,
            vmExecutionError
        ])
    })
    .transform((val) => {
        if (val.cause.name === "CallExecutionError") {
            return val.cause.cause.cause.data
        }
        return val.cause.data
    })

export const entryPointExecutionErrorSchema07 = z
    .object({
        name: z.literal("ContractFunctionExecutionError"),
        cause: z.discriminatedUnion("name", [
            errorCauseSchema,
            vmExecutionError
        ])
    })
    .transform((val) => {
        if (val.cause.name === "CallExecutionError") {
            return val.cause.cause.cause.data
        }
        return val.cause.data
    })
