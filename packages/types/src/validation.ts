import { z } from "zod"
import { HexData } from "./schemas"

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

export type ValsidationResult = {
    returnInfo: {
        preOpGas: bigint
        prefund: bigint
        sigFailed: boolean
        deadline: number
    }

    senderInfo: StakeInfo
    factoryInfo?: StakeInfo
    paymasterInfo?: StakeInfo
    aggregatorInfo?: StakeInfo
}

// hexnum regex
const hexPattern = /^(0x)?[0-9a-f]*$/

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
    name: z.literal("ContractFunctionExecutionError"),
    cause: z.object({
        name: z.literal("ContractFunctionRevertedError"),
        data: z.object({
            args: validationResultSchema,
            errorName: z.literal("ValidationResult")
        })
    })
})

export type ValidationResultError = z.infer<typeof validationResultErrorSchema>
