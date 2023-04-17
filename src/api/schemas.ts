import { getAddress } from "ethers/lib/utils"
import { z } from "zod"
import { BigNumber } from "ethers"
import { UserOperation } from "../types"

const hexNumberPattern = /^0x([1-9a-f]+[0-9a-f]*|0)$/
const hexDataPattern = /^0x[0-9a-f]*$/
const addressPattern = /^0x[0-9,a-f,A-F]{40}$/
const hexData32Pattern = /^0x([0-9a-f][0-9a-f]){0,32}$/

const addressSchema = z
    .string()
    .regex(addressPattern, { message: "not a valid hex address" })
    .transform((val) => getAddress(val))
const hexNumberSchema = z
    .string()
    .regex(hexNumberPattern)
    .or(z.number())
    .transform((val) => BigNumber.from(val))
const hexNumberRawSchema = z.string().regex(hexNumberPattern)
const hexDataSchema = z.string().regex(hexDataPattern, { message: "not valid hex data" })
const hexData32Schema = z.string().regex(hexData32Pattern, { message: "not valid 32-byte hex data" })

const userOperationSchema = z
    .object({
        sender: addressSchema,
        nonce: hexNumberSchema,
        initCode: hexDataSchema,
        callData: hexDataSchema,
        callGasLimit: hexNumberSchema,
        verificationGasLimit: hexNumberSchema,
        preVerificationGas: hexNumberSchema,
        maxPriorityFeePerGas: hexNumberSchema,
        maxFeePerGas: hexNumberSchema,
        paymasterAndData: hexDataSchema,
        signature: hexDataSchema,
    })
    .strict()
    .transform((val) => {
        return val as UserOperation
    })

const jsonRpcSchema = z
    .object({
        jsonrpc: z.literal("2.0"),
        id: z.number(),
        method: z.string(),
        params: z.array(z.unknown()),
    })
    .strict()

const jsonRpcResultSchema = z
    .object({
        jsonrpc: z.literal("2.0"),
        id: z.number(),
        result: z.unknown(),
    })
    .strict()

const chainIdRequestSchema = z.object({
    method: z.literal("eth_chainId"),
    params: z.tuple([]),
})

const supportedEntryPointsRequestSchema = z.object({
    method: z.literal("eth_supportedEntryPoints"),
    params: z.tuple([]),
})

const coinbaseRequestSchema = z.object({
    method: z.literal("eth_coinbase"),
    params: z.tuple([]),
})

const estimateUserOperationGasRequestSchema = z.object({
    method: z.literal("eth_estimateUserOperationGas"),
    params: z.tuple([userOperationSchema, addressSchema]),
})

const sendUserOperationRequestSchema = z.object({
    method: z.literal("eth_sendUserOperation"),
    params: z.tuple([userOperationSchema, addressSchema]),
})

const getUserOperationByHashRequestSchema = z.object({
    method: z.literal("eth_getUserOperationByHash"),
    params: z.tuple([hexData32Schema]),
})

const getUserOperationReceiptRequestSchema = z.object({
    method: z.literal("eth_getUserOperationReceipt"),
    params: z.tuple([hexData32Schema]),
})

const bundlerClearStateRequestSchema = z.object({
    method: z.literal("debug_bundler_clearState"),
    params: z.tuple([]),
})

const bundlerDumpMempoolRequestSchema = z.object({
    method: z.literal("debug_bundler_dumpMempool"),
    params: z.tuple([addressSchema]),
})

const bundlerSendBundleNowRequestSchema = z.object({
    method: z.literal("debug_bundler_sendBundleNow"),
    params: z.tuple([]),
})

const bundlerSetBundlingModeRequestSchema = z.object({
    method: z.literal("debug_bundler_setBundlingMode"),
    params: z.tuple([z.enum(["manual", "auto"])]),
})

const bundlerRequestSchema = z.discriminatedUnion("method", [
    chainIdRequestSchema,
    supportedEntryPointsRequestSchema,
    coinbaseRequestSchema,
    estimateUserOperationGasRequestSchema,
    sendUserOperationRequestSchema,
    getUserOperationByHashRequestSchema,
    getUserOperationReceiptRequestSchema,
    bundlerClearStateRequestSchema,
    bundlerDumpMempoolRequestSchema,
    bundlerSendBundleNowRequestSchema,
    bundlerSetBundlingModeRequestSchema,
])

const chainIdResponseSchema = z.object({
    method: z.literal("eth_chainId"),
    result: hexNumberRawSchema,
})

const supportedEntryPointsResponseSchema = z.object({
    method: z.literal("eth_supportedEntryPoints"),
    result: z.array(addressSchema),
})

const coinbaseResponseSchema = z.object({
    method: z.literal("eth_coinbase"),
    result: addressSchema,
})

const estimateUserOperationGasResponseSchema = z.object({
    method: z.literal("eth_estimateUserOperationGas"),
    result: z.object({
        callGasLimit: hexNumberRawSchema,
        preVerificationGas: hexNumberRawSchema,
        verificationGas: hexNumberRawSchema,
    }),
})

const sendUserOperationResponseSchema = z.object({
    method: z.literal("eth_sendUserOperation"),
    result: hexData32Schema,
})

const getUserOperationByHashResponseSchema = z.object({
    method: z.literal("eth_getUserOperationByHash"),
    result: z
        .object({
            userOperation: userOperationSchema,
            entryPoint: addressSchema,
            blockNumber: hexNumberRawSchema,
            blockHash: hexData32Schema,
            transactionHash: hexData32Schema,
        })
        .or(z.null()),
})

const logSchema = z.object({
    removed: z.boolean().optional(),
    logIndex: hexNumberRawSchema.optional(),
    transactionIndex: hexNumberRawSchema.optional(),
    transactionHash: hexData32Schema,
    blockHash: hexData32Schema.optional(),
    blockNumber: hexNumberRawSchema.optional(),
    address: addressSchema,
    data: hexDataSchema,
    topics: z.array(hexData32Schema),
})

const receiptSchema = z.object({
    transactionHash: hexData32Schema,
    transactionIndex: hexNumberRawSchema,
    blockHash: hexData32Schema,
    blockNumber: hexNumberRawSchema,
    from: addressSchema,
    to: addressSchema.or(z.null()),
    cumulativeGasUsed: hexNumberRawSchema,
    gasUsed: hexNumberRawSchema,
    contractAddress: addressSchema.or(z.null()),
    logs: z.array(logSchema),
    logsBloom: z.string().regex(/^0x[0-9a-f]{512}$/),
    root: hexData32Schema,
    status: hexNumberRawSchema.or(z.null()),
    effectiveGasPrice: hexNumberRawSchema,
})

const getUserOperationReceiptResponseSchema = z.object({
    method: z.literal("eth_getUserOperationReceipt"),
    result: z.object({
        userOpHash: hexData32Schema,
        nonce: hexNumberRawSchema,
        actualGasCost: hexNumberRawSchema,
        actualGasUsed: hexNumberRawSchema,
        success: z.boolean(),
        logs: z.array(logSchema),
        receipt: receiptSchema,
    }),
})

const bundlerClearStateResponseSchema = z.object({
    method: z.literal("debug_bundler_clearState"),
    result: z.literal("ok"),
})

const bundlerDumpMempoolResponseSchema = z.object({
    method: z.literal("debug_bundler_dumpMempool"),
    result: z.array(userOperationSchema),
})

const bundlerSendBundleNowResponseSchema = z.object({
    method: z.literal("debug_bundler_sendBundleNow"),
    result: hexData32Schema,
})

const bundlerSetBundlingModeResponseSchema = z.object({
    method: z.literal("debug_bundler_setBundlingMode"),
    result: z.literal("ok"),
})

const bundlerResponseSchema = z.discriminatedUnion("method", [
    chainIdResponseSchema,
    supportedEntryPointsResponseSchema,
    coinbaseResponseSchema,
    estimateUserOperationGasResponseSchema,
    sendUserOperationResponseSchema,
    getUserOperationByHashResponseSchema,
    getUserOperationReceiptResponseSchema,
    bundlerClearStateResponseSchema,
    bundlerDumpMempoolResponseSchema,
    bundlerSendBundleNowResponseSchema,
    bundlerSetBundlingModeResponseSchema,
])

export type ChainIdResponse = z.infer<typeof chainIdResponseSchema>
export type SupportedEntryPointsResponse = z.infer<typeof supportedEntryPointsResponseSchema>
export type CoinbaseResponse = z.infer<typeof coinbaseResponseSchema>
export type EstimateUserOperationGasResponse = z.infer<typeof estimateUserOperationGasResponseSchema>
export type SendUserOperationResponse = z.infer<typeof sendUserOperationResponseSchema>
export type GetUserOperationByHashResponse = z.infer<typeof getUserOperationByHashResponseSchema>
export type GetUserOperationReceiptResponse = z.infer<typeof getUserOperationReceiptResponseSchema>
export type BundlerClearStateResponse = z.infer<typeof bundlerClearStateResponseSchema>
export type BundlerDumpMempoolResponse = z.infer<typeof bundlerDumpMempoolResponseSchema>
export type BundlerSendBundleNowResponse = z.infer<typeof bundlerSendBundleNowResponseSchema>
export type BundlerSetBundlingModeResponse = z.infer<typeof bundlerSetBundlingModeResponseSchema>

export type ChainIdResponseResult = z.infer<typeof chainIdResponseSchema>["result"]
export type SupportedEntryPointsResponseResult = z.infer<typeof supportedEntryPointsResponseSchema>["result"]
export type CoinbaseResponseResult = z.infer<typeof coinbaseResponseSchema>["result"]
export type EstimateUserOperationGasResponseResult = z.infer<typeof estimateUserOperationGasResponseSchema>["result"]
export type SendUserOperationResponseResult = z.infer<typeof sendUserOperationResponseSchema>["result"]
export type GetUserOperationByHashResponseResult = z.infer<typeof getUserOperationByHashResponseSchema>["result"]
export type GetUserOperationReceiptResponseResult = z.infer<typeof getUserOperationReceiptResponseSchema>["result"]
export type BundlerClearStateResponseResult = z.infer<typeof bundlerClearStateResponseSchema>["result"]
export type BundlerDumpMempoolResponseResult = z.infer<typeof bundlerDumpMempoolResponseSchema>["result"]
export type BundlerSendBundleNowResponseResult = z.infer<typeof bundlerSendBundleNowResponseSchema>["result"]
export type BundlerSetBundlingModeResponseResult = z.infer<typeof bundlerSetBundlingModeResponseSchema>["result"]

export type BundlerResponse = z.infer<typeof bundlerResponseSchema>

export type ChainIdRequest = z.infer<typeof chainIdRequestSchema>
export type SupportedEntryPointsRequest = z.infer<typeof supportedEntryPointsRequestSchema>
export type CoinbaseRequest = z.infer<typeof coinbaseRequestSchema>
export type EstimateUserOperationGasRequest = z.infer<typeof estimateUserOperationGasRequestSchema>
export type SendUserOperationRequest = z.infer<typeof sendUserOperationRequestSchema>
export type GetUserOperationByHashRequest = z.infer<typeof getUserOperationByHashRequestSchema>
export type GetUserOperationReceiptRequest = z.infer<typeof getUserOperationReceiptRequestSchema>
export type BundlerClearStateRequest = z.infer<typeof bundlerClearStateRequestSchema>
export type BundlerDumpMempoolRequest = z.infer<typeof bundlerDumpMempoolRequestSchema>
export type BundlerSendBundleNowRequest = z.infer<typeof bundlerSendBundleNowRequestSchema>
export type BundlerSetBundlingModeRequest = z.infer<typeof bundlerSetBundlingModeRequestSchema>

export type ChainIdRequestParams = z.infer<typeof chainIdRequestSchema>["params"]
export type SupportedEntryPointsRequestParams = z.infer<typeof supportedEntryPointsRequestSchema>["params"]
export type CoinbaseRequestParams = z.infer<typeof coinbaseRequestSchema>["params"]
export type EstimateUserOperationGasRequestParams = z.infer<typeof estimateUserOperationGasRequestSchema>["params"]
export type SendUserOperationRequestParams = z.infer<typeof sendUserOperationRequestSchema>["params"]
export type GetUserOperationByHashRequestParams = z.infer<typeof getUserOperationByHashRequestSchema>["params"]
export type GetUserOperationReceiptRequestParams = z.infer<typeof getUserOperationReceiptRequestSchema>["params"]
export type BundlerClearStateRequestParams = z.infer<typeof bundlerClearStateRequestSchema>["params"]
export type BundlerDumpMempoolRequestParams = z.infer<typeof bundlerDumpMempoolRequestSchema>["params"]
export type BundlerSendBundleNowRequestParams = z.infer<typeof bundlerSendBundleNowRequestSchema>["params"]
export type BundlerSetBundlingModeRequestParams = z.infer<typeof bundlerSetBundlingModeRequestSchema>["params"]

export type BundlerRequest = z.infer<typeof bundlerRequestSchema>
export type JSONRPCRequest = z.infer<typeof jsonRpcSchema>
export type JSONRPCResponse = z.infer<typeof jsonRpcResultSchema>

export {
    chainIdRequestSchema,
    supportedEntryPointsRequestSchema,
    coinbaseRequestSchema,
    estimateUserOperationGasRequestSchema,
    sendUserOperationRequestSchema,
    getUserOperationByHashRequestSchema,
    getUserOperationReceiptRequestSchema,
    bundlerClearStateRequestSchema,
    bundlerDumpMempoolRequestSchema,
    bundlerSendBundleNowRequestSchema,
    bundlerSetBundlingModeRequestSchema,
    bundlerRequestSchema,
    jsonRpcSchema,
    jsonRpcResultSchema,
    userOperationSchema,
}

export { addressSchema, hexData32Schema, hexDataSchema }
