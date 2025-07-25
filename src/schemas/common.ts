import { type Hash, type Hex, getAddress, maxUint256 } from "viem"
import z from "zod/v4"
import { ofacList } from "./utils"

const hexDataPattern = /^0x[0-9A-Fa-f]*$/
const addressPattern = /^0x[0-9,a-f,A-F]{40}$/
const hexData32Pattern = /^0x([0-9a-fA-F][0-9a-fA-F]){32}$/
export const commaSeperatedAddressPattern =
    /^(0x[0-9a-fA-F]{40})(,\s*(0x[0-9a-fA-F]{40}))*$/

const addressSchema = z
    .string()
    .regex(addressPattern, { message: "not a valid hex address" })
    .transform((val) => getAddress(val))

const hexNumberSchema = z
    .string()
    .regex(hexDataPattern)
    .or(z.number())
    .or(z.bigint())
    .check((ctx) => {
        // This function is used to refine the input and provide a context where you have access to the path.
        try {
            if (ctx.value === "0x") {
                return
            }

            const bigIntData = BigInt(ctx.value) // Attempt to convert to BigInt to validate it can be done

            if (bigIntData > maxUint256) {
                ctx.issues.push({
                    code: "custom",
                    message:
                        "Invalid hexNumber, hexNumber cannot be greater than MAX_UINT_256",
                    input: ctx.value
                })
            }
        } catch {
            ctx.issues.push({
                code: "custom",
                message:
                    "Invalid input, expected a value that can be converted to bigint.",
                input: ctx.value
            })
        }
    })
    .transform((val) => {
        if (val === "0x") {
            return 0n
        }

        return BigInt(val)
    })
const hexDataSchema = z
    .string()
    .regex(hexDataPattern, { message: "not valid hex data" })
    .max(1000000, {
        message: "hex data too long, maximum length is 500,000 bytes"
    })
    .transform((val) => val.toLowerCase() as Hex)
const hexData32Schema = z
    .string()
    .regex(hexData32Pattern, { message: "not valid 32-byte hex data" })
    .transform((val) => val.toLowerCase() as Hash)

type Address = z.infer<typeof addressSchema>
type HexNumber = z.infer<typeof hexNumberSchema>
type HexData = z.infer<typeof hexDataSchema>
type HexData32 = z.infer<typeof hexData32Schema>

const compliantAddressSchema = addressSchema.refine(
    (val) => !ofacList.includes(val),
    {
        message: "Address is blacklisted"
    }
)

const gasPriceSchema = z.object({
    slow: z.object({
        maxFeePerGas: z.bigint(),
        maxPriorityFeePerGas: z.bigint()
    }),
    standard: z.object({
        maxFeePerGas: z.bigint(),
        maxPriorityFeePerGas: z.bigint()
    }),
    fast: z.object({
        maxFeePerGas: z.bigint(),
        maxPriorityFeePerGas: z.bigint()
    })
})

const logSchema = z.object({
    logIndex: hexNumberSchema,
    transactionIndex: hexNumberSchema,
    transactionHash: hexData32Schema,
    blockHash: hexData32Schema,
    blockNumber: hexNumberSchema,
    address: addressSchema,
    data: hexDataSchema,
    topics: z.array(hexData32Schema)
})

const receiptSchema = z.object({
    transactionHash: hexData32Schema,
    transactionIndex: hexNumberSchema,
    blockHash: hexData32Schema,
    blockNumber: hexNumberSchema,
    from: addressSchema,
    to: addressSchema.or(z.null()),
    cumulativeGasUsed: hexNumberSchema,
    gasUsed: hexNumberSchema,
    contractAddress: addressSchema.or(z.null()),
    logs: z.array(logSchema),
    logsBloom: z.string().regex(/^0x[0-9a-f]{512}$/),
    status: hexNumberSchema.or(z.null()),
    effectiveGasPrice: hexNumberSchema.nullish()
})

const userOperationReceiptSchema = z.object({
    userOpHash: hexData32Schema,
    entryPoint: addressSchema,
    sender: addressSchema,
    nonce: hexNumberSchema,
    paymaster: addressSchema.optional(),
    actualGasCost: hexNumberSchema,
    actualGasUsed: hexNumberSchema,
    success: z.boolean(),
    reason: hexDataSchema.optional(), // revert reason
    logs: z.array(logSchema),
    receipt: receiptSchema
})

type UserOperationReceipt = z.infer<typeof userOperationReceiptSchema>

const userOperationStatusSchema = z.object({
    status: z.enum([
        "not_found",
        "not_submitted",
        "submitted",
        "rejected",
        "reverted",
        "included",
        "failed"
    ]),
    transactionHash: hexData32Schema.or(z.null())
})

type UserOperationStatus = z.infer<typeof userOperationStatusSchema>

const altoVersions = z.enum(["v1", "v2"])

type AltoVersions = z.infer<typeof altoVersions>

export {
    addressSchema,
    hexNumberSchema,
    hexDataSchema,
    hexData32Schema,
    compliantAddressSchema,
    gasPriceSchema,
    userOperationReceiptSchema,
    logSchema,
    receiptSchema,
    userOperationStatusSchema,
    altoVersions,
    type Address,
    type HexNumber,
    type HexData,
    type HexData32,
    type UserOperationReceipt,
    type UserOperationStatus,
    type AltoVersions
}
