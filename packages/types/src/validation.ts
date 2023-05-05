import { HexData, addressSchema } from "./schemas"
import { z } from "zod"

export type StakeInfo = {
    addr: string
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

export const signatureValidationFailedSchema = z.tuple([addressSchema]).transform((val) => {
    return { aggregator: val[0] }
})

export type SignatureValidationFailed = z.infer<typeof signatureValidationFailedSchema>

export const signatureValidationFailedErrorSchema = z.object({
    args: signatureValidationFailedSchema,
    errorName: z.literal("SignatureValidationFailed")
})

export const senderAddressResultSchema = z.tuple([addressSchema]).transform((val) => {
    return {
        sender: val[0]
    }
})

export type SenderAddressResult = z.infer<typeof senderAddressResultSchema>

export const senderAddressResultErrorSchema = z.object({
    args: senderAddressResultSchema,
    errorName: z.literal("SenderAddressResult")
})

export const failedOpSchema = z.tuple([z.bigint(), z.string()]).transform((val) => {
    return { opIndex: val[0], reason: val[1] }
})

export type FailedOp = z.infer<typeof failedOpSchema>

export const failedOpErrorSchema = z.object({
    args: failedOpSchema,
    errorName: z.literal("FailedOp")
})

export const executionResultSchema = z
    .tuple([z.bigint(), z.bigint(), z.number(), z.number(), z.boolean(), z.string().regex(hexPattern)])
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

export type ExecutionResult = z.infer<typeof executionResultSchema>

export const executionResultErrorSchema = z.object({
    args: executionResultSchema,
    errorName: z.literal("ExecutionResult")
})

const stakeInfoSchema = z.object({
    stake: z.bigint(),
    unstakeDelaySec: z.bigint()
})

export const validationResultSchema = z
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
        stakeInfoSchema,
        stakeInfoSchema
    ])
    .transform((val) => {
        return {
            returnInfo: val[0],
            senderInfo: val[1],
            factoryInfo: val[2],
            paymasterInfo: val[3]
        }
    })

export type ValidationResult = z.infer<typeof validationResultSchema>

export const validationResultErrorSchema = z.object({
    args: validationResultSchema,
    errorName: z.literal("ValidationResult")
})

export type ValidationResultError = z.infer<typeof validationResultErrorSchema>

export const errorCauseSchema = z.object({
    name: z.literal("ContractFunctionRevertedError"),
    data: z.discriminatedUnion("errorName", [
        validationResultErrorSchema,
        executionResultErrorSchema,
        failedOpErrorSchema,
        senderAddressResultErrorSchema,
        signatureValidationFailedErrorSchema
    ])
})

export type ErrorCause = z.infer<typeof errorCauseSchema>

export const contractFunctionExecutionErrorSchema = z.object({
    name: z.literal("ContractFunctionExecutionError"),
    cause: errorCauseSchema
})

export type ContractFunctionExecutionError = z.infer<typeof contractFunctionExecutionErrorSchema>
