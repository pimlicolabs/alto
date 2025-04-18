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

export type SlotMap = {
    [slot: string]: string
}

export type StorageMap = {
    [address: string]: string | SlotMap
}

// hexnum regex
const hexPattern = /^0x[0-9a-f]*$/

export const signatureValidationFailedSchema = z
    .tuple([addressSchema])
    .transform((val) => {
        return { aggregator: val[0] }
    })

export type SignatureValidationFailed = z.infer<
    typeof signatureValidationFailedSchema
>

export const signatureValidationFailedErrorSchema = z.object({
    args: signatureValidationFailedSchema,
    errorName: z.literal("SignatureValidationFailed")
})

export const senderAddressResultSchema = z
    .tuple([addressSchema])
    .transform((val) => {
        return {
            sender: val[0]
        }
    })

export type SenderAddressResult = z.infer<typeof senderAddressResultSchema>

export const senderAddressResultErrorSchema = z.object({
    args: senderAddressResultSchema,
    errorName: z.literal("SenderAddressResult")
})

export const failedOpSchema = z
    .tuple([z.bigint(), z.string()])
    .transform((val) => {
        return { opIndex: val[0], reason: val[1] }
    })

export type FailedOp = z.infer<typeof failedOpSchema>

export const failedOpErrorSchema = z.object({
    args: failedOpSchema,
    errorName: z.literal("FailedOp")
})

export const failedOpWithRevertSchema = z
    .tuple([z.bigint(), z.string(), z.string()])
    .transform((val) => {
        return { opIndex: val[0], reason: val[1], inner: val[2] }
    })

export type FailedOpWithRevert = z.infer<typeof failedOpWithRevertSchema>

export const failedOpWithRevertErrorSchema = z.object({
    args: failedOpWithRevertSchema,
    errorName: z.literal("FailedOpWithRevert")
})

export const executionResultSchemaV06 = z
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

export const executionResultSchemaV07 = z
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
    executionResultSchemaV06,
    executionResultSchemaV07
])

export type ExecutionResult = z.infer<typeof executionResultSchema>

export const binarySearchCallResultSchema = z.object({
    gasUsed: z.bigint(),
    success: z.boolean(),
    returnData: z
        .string()
        .regex(hexPattern)
        .transform((val) => val as HexData)
})

export type BinarySearchCallResult = z.infer<
    typeof binarySearchCallResultSchema
>

export const executionResultErrorSchema = z.object({
    args: executionResultSchema,
    errorName: z.literal("ExecutionResult")
})

const stakeInfoSchema = z.object({
    addr: z.string().optional(),
    stake: z.bigint(),
    unstakeDelaySec: z.bigint()
})

export const validationResultSchemaV06 = z
    .tuple([
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
    ])
    .transform((val) => {
        return {
            returnInfo: val[0],
            senderInfo: val[1],
            factoryInfo: val[2],
            paymasterInfo: val[3]
        }
    })

export const validationResultSchemaV07 = z
    .tuple([
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
    ])
    .transform((val) => {
        return {
            returnInfo: val[0],
            senderInfo: val[1],
            factoryInfo: val[2],
            paymasterInfo: val[3]
        }
    })

export const validationResultSchema = z.union([
    validationResultSchemaV06,
    validationResultSchemaV07
])

export type ValidationResultV06 = z.infer<typeof validationResultSchemaV06>
export type ValidationResultV07 = z.infer<typeof validationResultSchemaV07>

export type ValidationResult = z.infer<typeof validationResultSchema>

export const validationResultErrorSchema = z.object({
    args: validationResultSchema,
    errorName: z.literal("ValidationResult")
})

export type ValidationResultError = z.infer<typeof validationResultErrorSchema>

export const validationResultWithAggregationSchemaV06 = z
    .tuple([
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
        z
            .object({
                aggregator: addressSchema,
                stakeInfo: stakeInfoSchema
            })
            .optional()
    ])
    .transform((val) => {
        return {
            returnInfo: val[0],
            senderInfo: val[1],
            factoryInfo: val[2],
            paymasterInfo: val[3],
            aggregatorInfo: val[4]
        }
    })

export const validationResultWithAggregationSchemaV07 = z
    .tuple([
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
        z
            .object({
                aggregator: addressSchema,
                stakeInfo: stakeInfoSchema
            })
            .optional()
    ])
    .transform((val) => {
        return {
            returnInfo: val[0],
            senderInfo: val[1],
            factoryInfo: val[2],
            paymasterInfo: val[3],
            aggregatorInfo: val[4]
        }
    })

export const validationResultWithAggregationSchema = z.union([
    validationResultWithAggregationSchemaV06,
    validationResultWithAggregationSchemaV07
])

export type ValidationResultWithAggregationV06 = z.infer<
    typeof validationResultWithAggregationSchemaV06
>

export type ValidationResultWithAggregationV07 = z.infer<
    typeof validationResultWithAggregationSchemaV07
>

export type ValidationResultWithAggregation = z.infer<
    typeof validationResultWithAggregationSchema
>

export const validationResultWithAggregationErrorSchema = z.object({
    args: validationResultWithAggregationSchema,
    errorName: z.literal("ValidationResultWithAggregation")
})

export const entryPointErrorsSchema = z.discriminatedUnion("errorName", [
    validationResultErrorSchema,
    executionResultErrorSchema,
    failedOpErrorSchema,
    senderAddressResultErrorSchema,
    signatureValidationFailedErrorSchema,
    validationResultWithAggregationErrorSchema
])

export const errorCauseSchema = z.object({
    name: z.literal("ContractFunctionRevertedError"),
    data: entryPointErrorsSchema
})

export type ErrorCause = z.infer<typeof errorCauseSchema>

export const vmExecutionError = z.object({
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

export const entryPointExecutionErrorSchemaV06 = z
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

export type EntryPointExecutionErrorV06 = z.infer<
    typeof entryPointExecutionErrorSchemaV06
>

export const entryPointExecutionErrorSchemaV07 = z
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

export type EntryPointExecutionErrorV07 = z.infer<
    typeof entryPointExecutionErrorSchemaV07
>
