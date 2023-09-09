import { Hash, Hex, getAddress } from "viem"
import { z } from "zod"

const hexDataPattern = /^0x[0-9A-Fa-f]*$/
const addressPattern = /^0x[0-9,a-f,A-F]{40}$/
export const hexData32Pattern = /^0x([0-9a-fA-F][0-9a-fA-F]){0,32}$/

const addressSchema = z
    .string()
    .regex(addressPattern, { message: "not a valid hex address" })
    .transform((val) => getAddress(val))
export const hexNumberSchema = z
    .string()
    .regex(hexDataPattern)
    .or(z.number())
    .or(z.bigint())
    .transform((val) => BigInt(val))
const hexDataSchema = z
    .string()
    .regex(hexDataPattern, { message: "not valid hex data" })
    .transform((val) => val.toLowerCase() as Hex)
const hexData32Schema = z
    .string()
    .regex(hexData32Pattern, { message: "not valid 32-byte hex data" })
    .transform((val) => val.toLowerCase() as Hash)

export type Address = z.infer<typeof addressSchema>
export type HexNumber = z.infer<typeof hexNumberSchema>
export type HexData = z.infer<typeof hexDataSchema>
export type HexData32 = z.infer<typeof hexData32Schema>

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
        signature: hexDataSchema
    })
    .strict()
    .transform((val) => {
        return val
    })

const partialUserOperationSchema = z
    .object({
        sender: addressSchema,
        nonce: hexNumberSchema,
        initCode: hexDataSchema,
        callData: hexDataSchema,
        callGasLimit: hexNumberSchema.default(1n),
        verificationGasLimit: hexNumberSchema.default(1n),
        preVerificationGas: hexNumberSchema.default(1n),
        maxPriorityFeePerGas: hexNumberSchema.default(1n),
        maxFeePerGas: hexNumberSchema.default(1n),
        paymasterAndData: hexDataSchema,
        signature: hexDataSchema
    })
    .strict()
    .transform((val) => {
        return val
    })

export type UserOperation = {
    sender: Address
    nonce: bigint
    initCode: HexData
    callData: HexData
    callGasLimit: bigint
    verificationGasLimit: bigint
    preVerificationGas: bigint
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
    paymasterAndData: HexData
    signature: HexData
}

export type UserOperationRequest = {
    userOperation: UserOperation
    entryPoint: Address
}

export type UserOperationWithHash = {
    userOperation: UserOperation
    userOperationHash: HexData32
}

const jsonRpcSchema = z
    .object({
        jsonrpc: z.literal("2.0"),
        id: z.number(),
        method: z.string(),
        params: z
            .array(z.unknown())
            .optional()
            .transform((val) => val ?? [])
    })
    .strict()

const jsonRpcResultSchema = z
    .object({
        jsonrpc: z.literal("2.0"),
        id: z.number(),
        result: z.unknown()
    })
    .strict()

const chainIdRequestSchema = z.object({
    method: z.literal("eth_chainId"),
    params: z.tuple([])
})

const supportedEntryPointsRequestSchema = z.object({
    method: z.literal("eth_supportedEntryPoints"),
    params: z.tuple([])
})

const estimateUserOperationGasRequestSchema = z.object({
    method: z.literal("eth_estimateUserOperationGas"),
    params: z.tuple([partialUserOperationSchema, addressSchema])
})

const sendUserOperationRequestSchema = z.object({
    method: z.literal("eth_sendUserOperation"),
    params: z.tuple([userOperationSchema, addressSchema])
})

const getUserOperationByHashRequestSchema = z.object({
    method: z.literal("eth_getUserOperationByHash"),
    params: z.tuple([hexData32Schema])
})

const getUserOperationReceiptRequestSchema = z.object({
    method: z.literal("eth_getUserOperationReceipt"),
    params: z.tuple([hexData32Schema])
})

const bundlerClearStateRequestSchema = z.object({
    method: z.literal("debug_bundler_clearState"),
    params: z.tuple([])
})

const bundlerDumpMempoolRequestSchema = z.object({
    method: z.literal("debug_bundler_dumpMempool"),
    params: z.tuple([addressSchema])
})

const bundlerSendBundleNowRequestSchema = z.object({
    method: z.literal("debug_bundler_sendBundleNow"),
    params: z.tuple([])
})

const bundlerSetBundlingModeRequestSchema = z.object({
    method: z.literal("debug_bundler_setBundlingMode"),
    params: z.tuple([z.enum(["manual", "auto"])])
})

const pimlicoGetUserOperationStatusRequestSchema = z.object({
    method: z.literal("pimlico_getUserOperationStatus"),
    params: z.tuple([hexData32Schema])
})

const pimlicoGetUserOperationGasPriceRequestSchema = z.object({
    method: z.literal("pimlico_getUserOperationGasPrice"),
    params: z.tuple([])
})

const bundlerRequestSchema = z.discriminatedUnion("method", [
    chainIdRequestSchema,
    supportedEntryPointsRequestSchema,
    estimateUserOperationGasRequestSchema,
    sendUserOperationRequestSchema,
    getUserOperationByHashRequestSchema,
    getUserOperationReceiptRequestSchema,
    bundlerClearStateRequestSchema,
    bundlerDumpMempoolRequestSchema,
    bundlerSendBundleNowRequestSchema,
    bundlerSetBundlingModeRequestSchema,
    pimlicoGetUserOperationStatusRequestSchema,
    pimlicoGetUserOperationGasPriceRequestSchema
])

const chainIdResponseSchema = z.object({
    method: z.literal("eth_chainId"),
    result: hexNumberSchema
})

const supportedEntryPointsResponseSchema = z.object({
    method: z.literal("eth_supportedEntryPoints"),
    result: z.array(addressSchema)
})

const estimateUserOperationGasResponseSchema = z.object({
    method: z.literal("eth_estimateUserOperationGas"),
    result: z.object({
        callGasLimit: hexNumberSchema,
        preVerificationGas: hexNumberSchema,
        verificationGasLimit: hexNumberSchema,
        verificationGas: hexNumberSchema.optional()
    })
})

const sendUserOperationResponseSchema = z.object({
    method: z.literal("eth_sendUserOperation"),
    result: hexData32Schema
})

const getUserOperationByHashResponseSchema = z.object({
    method: z.literal("eth_getUserOperationByHash"),
    result: z
        .object({
            userOperation: userOperationSchema,
            entryPoint: addressSchema,
            blockNumber: hexNumberSchema,
            blockHash: hexData32Schema,
            transactionHash: hexData32Schema
        })
        .or(z.null())
})

const logSchema = z.object({
    //removed: z.boolean().optional(),
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
    //root: hexData32Schema,
    status: hexNumberSchema.or(z.null()),
    effectiveGasPrice: hexNumberSchema
    //type: hexNumberSchema
})

const getUserOperationReceiptResponseSchema = z.object({
    method: z.literal("eth_getUserOperationReceipt"),
    result: z
        .object({
            userOpHash: hexData32Schema,
            sender: addressSchema,
            nonce: hexNumberSchema,
            actualGasCost: hexNumberSchema,
            actualGasUsed: hexNumberSchema,
            success: z.boolean(),
            logs: z.array(logSchema),
            receipt: receiptSchema
        })
        .or(z.null())
})

const bundlerClearStateResponseSchema = z.object({
    method: z.literal("debug_bundler_clearState"),
    result: z.literal("ok")
})

const bundlerDumpMempoolResponseSchema = z.object({
    method: z.literal("debug_bundler_dumpMempool"),
    result: z.array(userOperationSchema)
})

const bundlerSendBundleNowResponseSchema = z.object({
    method: z.literal("debug_bundler_sendBundleNow"),
    result: hexData32Schema
})

const bundlerSetBundlingModeResponseSchema = z.object({
    method: z.literal("debug_bundler_setBundlingMode"),
    result: z.literal("ok")
})

const userOperationStatus = z.object({
    status: z.enum(["not_found", "not_submitted", "submitted", "rejected", "reverted", "included", "failed"]),
    transactionHash: hexData32Schema.or(z.null())
})

export type UserOperationStatus = z.infer<typeof userOperationStatus>

const pimlicoGetUserOperationStatusResponseSchema = z.object({
    method: z.literal("pimlico_getUserOperationStatus"),
    result: userOperationStatus
})

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

const pimlicoGetUserOperationGasPriceResponseSchema = z.object({
    method: z.literal("pimlico_getUserOperationGasPrice"),
    result: gasPriceSchema
})

const bundlerResponseSchema = z.discriminatedUnion("method", [
    chainIdResponseSchema,
    supportedEntryPointsResponseSchema,
    estimateUserOperationGasResponseSchema,
    sendUserOperationResponseSchema,
    getUserOperationByHashResponseSchema,
    getUserOperationReceiptResponseSchema,
    bundlerClearStateResponseSchema,
    bundlerDumpMempoolResponseSchema,
    bundlerSendBundleNowResponseSchema,
    bundlerSetBundlingModeResponseSchema,
    pimlicoGetUserOperationStatusResponseSchema,
    pimlicoGetUserOperationGasPriceResponseSchema
])

export type BundlingMode = z.infer<typeof bundlerSetBundlingModeRequestSchema>["params"][0]

export type ChainIdResponse = z.infer<typeof chainIdResponseSchema>
export type SupportedEntryPointsResponse = z.infer<typeof supportedEntryPointsResponseSchema>
export type EstimateUserOperationGasResponse = z.infer<typeof estimateUserOperationGasResponseSchema>
export type SendUserOperationResponse = z.infer<typeof sendUserOperationResponseSchema>
export type GetUserOperationByHashResponse = z.infer<typeof getUserOperationByHashResponseSchema>
export type GetUserOperationReceiptResponse = z.infer<typeof getUserOperationReceiptResponseSchema>
export type BundlerClearStateResponse = z.infer<typeof bundlerClearStateResponseSchema>
export type BundlerDumpMempoolResponse = z.infer<typeof bundlerDumpMempoolResponseSchema>
export type BundlerSendBundleNowResponse = z.infer<typeof bundlerSendBundleNowResponseSchema>
export type BundlerSetBundlingModeResponse = z.infer<typeof bundlerSetBundlingModeResponseSchema>
export type PimlicoGetUserOperationStatusResponse = z.infer<typeof pimlicoGetUserOperationStatusResponseSchema>
export type PimlicoGetUserOperationGasPriceResponse = z.infer<typeof pimlicoGetUserOperationGasPriceResponseSchema>

export type ChainIdResponseResult = z.infer<typeof chainIdResponseSchema>["result"]
export type SupportedEntryPointsResponseResult = z.infer<typeof supportedEntryPointsResponseSchema>["result"]
export type EstimateUserOperationGasResponseResult = z.infer<typeof estimateUserOperationGasResponseSchema>["result"]
export type SendUserOperationResponseResult = z.infer<typeof sendUserOperationResponseSchema>["result"]
export type GetUserOperationByHashResponseResult = z.infer<typeof getUserOperationByHashResponseSchema>["result"]
export type GetUserOperationReceiptResponseResult = z.infer<typeof getUserOperationReceiptResponseSchema>["result"]
export type BundlerClearStateResponseResult = z.infer<typeof bundlerClearStateResponseSchema>["result"]
export type BundlerDumpMempoolResponseResult = z.infer<typeof bundlerDumpMempoolResponseSchema>["result"]
export type BundlerSendBundleNowResponseResult = z.infer<typeof bundlerSendBundleNowResponseSchema>["result"]
export type BundlerSetBundlingModeResponseResult = z.infer<typeof bundlerSetBundlingModeResponseSchema>["result"]
export type PimlicoGetUserOperationStatusResponseResult = z.infer<
    typeof pimlicoGetUserOperationStatusResponseSchema
>["result"]
export type PimlicoGetUserOperationGasPriceResponseResult = z.infer<
    typeof pimlicoGetUserOperationGasPriceResponseSchema
>["result"]

export type BundlerResponse = z.infer<typeof bundlerResponseSchema>

export type ChainIdRequest = z.infer<typeof chainIdRequestSchema>
export type SupportedEntryPointsRequest = z.infer<typeof supportedEntryPointsRequestSchema>
export type EstimateUserOperationGasRequest = z.infer<typeof estimateUserOperationGasRequestSchema>
export type SendUserOperationRequest = z.infer<typeof sendUserOperationRequestSchema>
export type GetUserOperationByHashRequest = z.infer<typeof getUserOperationByHashRequestSchema>
export type GetUserOperationReceiptRequest = z.infer<typeof getUserOperationReceiptRequestSchema>
export type BundlerClearStateRequest = z.infer<typeof bundlerClearStateRequestSchema>
export type BundlerDumpMempoolRequest = z.infer<typeof bundlerDumpMempoolRequestSchema>
export type BundlerSendBundleNowRequest = z.infer<typeof bundlerSendBundleNowRequestSchema>
export type BundlerSetBundlingModeRequest = z.infer<typeof bundlerSetBundlingModeRequestSchema>
export type PimlicoGetUserOperationStatusRequest = z.infer<typeof pimlicoGetUserOperationStatusRequestSchema>
export type PimlicoGetUserOperationGasPriceRequest = z.infer<typeof pimlicoGetUserOperationGasPriceRequestSchema>

export type ChainIdRequestParams = z.infer<typeof chainIdRequestSchema>["params"]
export type SupportedEntryPointsRequestParams = z.infer<typeof supportedEntryPointsRequestSchema>["params"]
export type EstimateUserOperationGasRequestParams = z.infer<typeof estimateUserOperationGasRequestSchema>["params"]
export type SendUserOperationRequestParams = z.infer<typeof sendUserOperationRequestSchema>["params"]
export type GetUserOperationByHashRequestParams = z.infer<typeof getUserOperationByHashRequestSchema>["params"]
export type GetUserOperationReceiptRequestParams = z.infer<typeof getUserOperationReceiptRequestSchema>["params"]
export type BundlerClearStateRequestParams = z.infer<typeof bundlerClearStateRequestSchema>["params"]
export type BundlerDumpMempoolRequestParams = z.infer<typeof bundlerDumpMempoolRequestSchema>["params"]
export type BundlerSendBundleNowRequestParams = z.infer<typeof bundlerSendBundleNowRequestSchema>["params"]
export type BundlerSetBundlingModeRequestParams = z.infer<typeof bundlerSetBundlingModeRequestSchema>["params"]
export type PimlicoGetUserOperationStatusRequestParams = z.infer<
    typeof pimlicoGetUserOperationStatusRequestSchema
>["params"]
export type PimlicoGetUserOperationGasPriceRequestParams = z.infer<
    typeof pimlicoGetUserOperationGasPriceRequestSchema
>["params"]

export type BundlerRequest = z.infer<typeof bundlerRequestSchema>
export type JSONRPCRequest = z.infer<typeof jsonRpcSchema>
export type JSONRPCResponse = z.infer<typeof jsonRpcResultSchema>

export {
    chainIdRequestSchema,
    supportedEntryPointsRequestSchema,
    estimateUserOperationGasRequestSchema,
    sendUserOperationRequestSchema,
    getUserOperationByHashRequestSchema,
    getUserOperationReceiptRequestSchema,
    bundlerClearStateRequestSchema,
    bundlerDumpMempoolRequestSchema,
    bundlerSendBundleNowRequestSchema,
    bundlerSetBundlingModeRequestSchema,
    pimlicoGetUserOperationStatusRequestSchema,
    pimlicoGetUserOperationGasPriceRequestSchema,
    bundlerRequestSchema,
    jsonRpcSchema,
    jsonRpcResultSchema,
    userOperationSchema
}

export {
    chainIdResponseSchema,
    supportedEntryPointsResponseSchema,
    estimateUserOperationGasResponseSchema,
    sendUserOperationResponseSchema,
    getUserOperationByHashResponseSchema,
    getUserOperationReceiptResponseSchema,
    bundlerClearStateResponseSchema,
    bundlerDumpMempoolResponseSchema,
    bundlerSendBundleNowResponseSchema,
    bundlerSetBundlingModeResponseSchema,
    pimlicoGetUserOperationStatusResponseSchema,
    pimlicoGetUserOperationGasPriceResponseSchema,
    bundlerResponseSchema
}

export { addressSchema, hexData32Schema, hexDataSchema, logSchema, receiptSchema }
