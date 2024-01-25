import { type Hash, type Hex, getAddress } from "viem"
import { z } from "zod"
import { MempoolUserOperation } from "./mempool"

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
    .transform((val) => val as Hex)
const hexData32Schema = z
    .string()
    .regex(hexData32Pattern, { message: "not valid 32-byte hex data" })
    .transform((val) => val as Hash)

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

export type CompressedUserOperation = {
    compressedCalldata: Hex
    inflatedOp: UserOperation
    inflatorAddress: Address
    inflatorId: number
}

export type UserOperationRequest = {
    userOperation: UserOperation
    entryPoint: Address
}

export type UserOperationWithHash = {
    mempoolUserOperation: MempoolUserOperation
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

const stateOverridesSchema = z.record(
    addressSchema,
    z.object({
        balance: hexNumberSchema.optional(),
        nonce: hexNumberSchema.optional(),
        code: hexDataSchema.optional(),
        state: z.unknown().optional(),
        stateDiff: z.unknown().optional()
    })
)

export type StateOverrides = z.infer<typeof stateOverridesSchema>

const estimateUserOperationGasRequestSchema = z.object({
    method: z.literal("eth_estimateUserOperationGas"),
    params: z.union([
        z.tuple([partialUserOperationSchema, addressSchema]),
        z.tuple([
            partialUserOperationSchema,
            addressSchema,
            stateOverridesSchema
        ])
    ])
})

const sendUserOperationRequestSchema = z.object({
    method: z.literal("eth_sendUserOperation"),
    params: z.tuple([userOperationSchema, addressSchema])
})

const getUserOperationByHashRequestSchema = z.object({
    method: z.literal("eth_getUserOperationByHash"),
    params: z.tuple([
        z
            .string()
            .regex(hexData32Pattern, { message: "Missing/invalid userOpHash" })
            .transform((val) => val as Hex)
    ])
})

const getUserOperationReceiptRequestSchema = z.object({
    method: z.literal("eth_getUserOperationReceipt"),
    params: z.tuple([
        z
            .string()
            .regex(hexData32Pattern, { message: "Missing/invalid userOpHash" })
            .transform((val) => val as Hex)
    ])
})

const bundlerClearStateRequestSchema = z.object({
    method: z.literal("debug_bundler_clearState"),
    params: z.tuple([])
})

const bundlerClearMempoolRequestSchema = z.object({
    method: z.literal("debug_bundler_clearMempool"),
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

const bundlerSetReputationsRequestSchema = z.object({
    method: z.literal("debug_bundler_setReputation"),
    params: z.tuple([
        z.array(
            z.object({
                address: addressSchema,
                opsSeen: hexNumberSchema,
                opsIncluded: hexNumberSchema
            })
        ),
        addressSchema
    ])
})

const bundlerDumpReputationsRequestSchema = z.object({
    method: z.literal("debug_bundler_dumpReputation"),
    params: z.tuple([addressSchema])
})

const pimlicoGetStakeStatusRequestSchema = z.object({
    method: z.literal("debug_bundler_getStakeStatus"),
    params: z.tuple([addressSchema, addressSchema])
})

const pimlicoGetUserOperationStatusRequestSchema = z.object({
    method: z.literal("pimlico_getUserOperationStatus"),
    params: z.tuple([hexData32Schema])
})

const pimlicoGetUserOperationGasPriceRequestSchema = z.object({
    method: z.literal("pimlico_getUserOperationGasPrice"),
    params: z.tuple([])
})

const pimlicoSendCompressedUserOperationRequestSchema = z.object({
    method: z.literal("pimlico_sendCompressedUserOperation"),
    params: z.tuple([hexDataSchema, addressSchema, addressSchema])
})

const bundlerRequestSchema = z.discriminatedUnion("method", [
    chainIdRequestSchema,
    supportedEntryPointsRequestSchema,
    estimateUserOperationGasRequestSchema,
    sendUserOperationRequestSchema,
    getUserOperationByHashRequestSchema,
    getUserOperationReceiptRequestSchema,
    bundlerClearStateRequestSchema,
    bundlerClearMempoolRequestSchema,
    bundlerDumpMempoolRequestSchema,
    bundlerSendBundleNowRequestSchema,
    bundlerSetBundlingModeRequestSchema,
    bundlerSetReputationsRequestSchema,
    bundlerDumpReputationsRequestSchema,
    pimlicoGetStakeStatusRequestSchema,
    pimlicoGetUserOperationStatusRequestSchema,
    pimlicoGetUserOperationGasPriceRequestSchema,
    pimlicoSendCompressedUserOperationRequestSchema
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

const bundlerClearMempoolResponseSchema = z.object({
    method: z.literal("debug_bundler_clearMempool"),
    result: z.literal("ok")
})

const bundlerDumpMempoolResponseSchema = z.object({
    method: z.literal("debug_bundler_dumpMempool"),
    result: z.array(userOperationSchema)
})

const bundlerGetStakeStatusResponseSchema = z.object({
    method: z.literal("debug_bundler_getStakeStatus"),
    result: z.object({
        stakeInfo: z.object({
            addr: z.string(),
            stake: z
                .string()
                .or(z.number())
                .or(z.bigint())
                .transform((val) => Number(val).toString()),
            unstakeDelaySec: z
                .string()
                .or(z.number())
                .or(z.bigint())
                .transform((val) => Number(val).toString())
        }),
        isStaked: z.boolean()
    })
})

const bundlerSendBundleNowResponseSchema = z.object({
    method: z.literal("debug_bundler_sendBundleNow"),
    result: hexData32Schema
})

const bundlerSetBundlingModeResponseSchema = z.object({
    method: z.literal("debug_bundler_setBundlingMode"),
    result: z.literal("ok")
})

const bundlerSetReputationsResponseSchema = z.object({
    method: z.literal("debug_bundler_setReputation"),
    result: z.literal("ok")
})

const bundlerDumpReputationsResponseSchema = z.object({
    method: z.literal("debug_bundler_dumpReputation"),
    // TODO: FIX
    result: z.array(
        z.object({
            address: addressSchema,
            opsSeen: hexNumberSchema,
            opsIncluded: hexNumberSchema,
            status: hexNumberSchema.optional()
        })
    )
})

const userOperationStatus = z.object({
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

const pimlicoSendCompressedUserOperationResponseSchema = z.object({
    method: z.literal("pimlico_sendCompressedUserOperation"),
    result: hexData32Schema
})

const bundlerResponseSchema = z.discriminatedUnion("method", [
    chainIdResponseSchema,
    supportedEntryPointsResponseSchema,
    estimateUserOperationGasResponseSchema,
    sendUserOperationResponseSchema,
    getUserOperationByHashResponseSchema,
    getUserOperationReceiptResponseSchema,
    bundlerClearStateResponseSchema,
    bundlerClearMempoolResponseSchema,
    bundlerDumpMempoolResponseSchema,
    bundlerGetStakeStatusResponseSchema,
    bundlerSendBundleNowResponseSchema,
    bundlerSetBundlingModeResponseSchema,
    bundlerSetReputationsResponseSchema,
    bundlerDumpReputationsResponseSchema,
    pimlicoGetUserOperationStatusResponseSchema,
    pimlicoGetUserOperationGasPriceResponseSchema,
    pimlicoSendCompressedUserOperationResponseSchema
])

export type BundlingMode = z.infer<
    typeof bundlerSetBundlingModeRequestSchema
>["params"][0]

export type Reputations = z.infer<
    typeof bundlerSetReputationsRequestSchema
>["params"][0]

export type ChainIdResponse = z.infer<typeof chainIdResponseSchema>
export type SupportedEntryPointsResponse = z.infer<
    typeof supportedEntryPointsResponseSchema
>
export type EstimateUserOperationGasResponse = z.infer<
    typeof estimateUserOperationGasResponseSchema
>
export type SendUserOperationResponse = z.infer<
    typeof sendUserOperationResponseSchema
>
export type GetUserOperationByHashResponse = z.infer<
    typeof getUserOperationByHashResponseSchema
>
export type GetUserOperationReceiptResponse = z.infer<
    typeof getUserOperationReceiptResponseSchema
>
export type BundlerClearStateResponse = z.infer<
    typeof bundlerClearStateResponseSchema
>
export type BundlerClearMempoolResponse = z.infer<
    typeof bundlerClearMempoolResponseSchema
>
export type BundlerDumpMempoolResponse = z.infer<
    typeof bundlerDumpMempoolResponseSchema
>
export type BundlerGetStakeStatusResponse = z.infer<
    typeof bundlerGetStakeStatusResponseSchema
>
export type BundlerSendBundleNowResponse = z.infer<
    typeof bundlerSendBundleNowResponseSchema
>
export type BundlerSetBundlingModeResponse = z.infer<
    typeof bundlerSetBundlingModeResponseSchema
>
export type BundlerSetReputationsResponse = z.infer<
    typeof bundlerSetReputationsResponseSchema
>
export type BundlerDumpReputationsResponse = z.infer<
    typeof bundlerDumpReputationsResponseSchema
>
export type PimlicoGetUserOperationStatusResponse = z.infer<
    typeof pimlicoGetUserOperationStatusResponseSchema
>
export type PimlicoGetUserOperationGasPriceResponse = z.infer<
    typeof pimlicoGetUserOperationGasPriceResponseSchema
>

export type ChainIdResponseResult = z.infer<
    typeof chainIdResponseSchema
>["result"]
export type SupportedEntryPointsResponseResult = z.infer<
    typeof supportedEntryPointsResponseSchema
>["result"]
export type EstimateUserOperationGasResponseResult = z.infer<
    typeof estimateUserOperationGasResponseSchema
>["result"]
export type SendUserOperationResponseResult = z.infer<
    typeof sendUserOperationResponseSchema
>["result"]
export type GetUserOperationByHashResponseResult = z.infer<
    typeof getUserOperationByHashResponseSchema
>["result"]
export type GetUserOperationReceiptResponseResult = z.infer<
    typeof getUserOperationReceiptResponseSchema
>["result"]
export type BundlerClearStateResponseResult = z.infer<
    typeof bundlerClearStateResponseSchema
>["result"]
export type BundlerClearMempoolResponseResult = z.infer<
    typeof bundlerClearMempoolResponseSchema
>["result"]
export type BundlerDumpMempoolResponseResult = z.infer<
    typeof bundlerDumpMempoolResponseSchema
>["result"]
export type BundlerGetStakeStatusResponseResult = z.infer<
    typeof bundlerGetStakeStatusResponseSchema
>["result"]
export type BundlerSendBundleNowResponseResult = z.infer<
    typeof bundlerSendBundleNowResponseSchema
>["result"]
export type BundlerSetBundlingModeResponseResult = z.infer<
    typeof bundlerSetBundlingModeResponseSchema
>["result"]
export type BundlerSetReputationsResponseResult = z.infer<
    typeof bundlerSetReputationsResponseSchema
>["result"]
export type BundlerDumpReputationsResponseResult = z.infer<
    typeof bundlerDumpReputationsResponseSchema
>["result"]
export type PimlicoGetUserOperationStatusResponseResult = z.infer<
    typeof pimlicoGetUserOperationStatusResponseSchema
>["result"]
export type PimlicoGetUserOperationGasPriceResponseResult = z.infer<
    typeof pimlicoGetUserOperationGasPriceResponseSchema
>["result"]

export type BundlerResponse = z.infer<typeof bundlerResponseSchema>

export type ChainIdRequest = z.infer<typeof chainIdRequestSchema>
export type SupportedEntryPointsRequest = z.infer<
    typeof supportedEntryPointsRequestSchema
>
export type EstimateUserOperationGasRequest = z.infer<
    typeof estimateUserOperationGasRequestSchema
>
export type SendUserOperationRequest = z.infer<
    typeof sendUserOperationRequestSchema
>
export type GetUserOperationByHashRequest = z.infer<
    typeof getUserOperationByHashRequestSchema
>
export type GetUserOperationReceiptRequest = z.infer<
    typeof getUserOperationReceiptRequestSchema
>
export type BundlerClearStateRequest = z.infer<
    typeof bundlerClearStateRequestSchema
>
export type BundlerClearMempoolRequest = z.infer<
    typeof bundlerClearMempoolRequestSchema
>
export type BundlerDumpMempoolRequest = z.infer<
    typeof bundlerDumpMempoolRequestSchema
>
export type BundlerSendBundleNowRequest = z.infer<
    typeof bundlerSendBundleNowRequestSchema
>
export type BundlerSetBundlingModeRequest = z.infer<
    typeof bundlerSetBundlingModeRequestSchema
>
export type BundlerSetReputationsRequest = z.infer<
    typeof bundlerSetReputationsRequestSchema
>
export type BundlerDumpReputationsRequest = z.infer<
    typeof bundlerDumpReputationsRequestSchema
>
export type BundlerGetStakeStatusRequest = z.infer<
    typeof pimlicoGetStakeStatusRequestSchema
>
export type PimlicoGetUserOperationStatusRequest = z.infer<
    typeof pimlicoGetUserOperationStatusRequestSchema
>
export type PimlicoGetUserOperationGasPriceRequest = z.infer<
    typeof pimlicoGetUserOperationGasPriceRequestSchema
>

export type ChainIdRequestParams = z.infer<
    typeof chainIdRequestSchema
>["params"]
export type SupportedEntryPointsRequestParams = z.infer<
    typeof supportedEntryPointsRequestSchema
>["params"]
export type EstimateUserOperationGasRequestParams = z.infer<
    typeof estimateUserOperationGasRequestSchema
>["params"]
export type SendUserOperationRequestParams = z.infer<
    typeof sendUserOperationRequestSchema
>["params"]
export type GetUserOperationByHashRequestParams = z.infer<
    typeof getUserOperationByHashRequestSchema
>["params"]
export type GetUserOperationReceiptRequestParams = z.infer<
    typeof getUserOperationReceiptRequestSchema
>["params"]
export type BundlerClearStateRequestParams = z.infer<
    typeof bundlerClearStateRequestSchema
>["params"]
export type BundlerClearMempoolRequestParams = z.infer<
    typeof bundlerClearMempoolRequestSchema
>["params"]
export type BundlerDumpMempoolRequestParams = z.infer<
    typeof bundlerDumpMempoolRequestSchema
>["params"]
export type BundlerSendBundleNowRequestParams = z.infer<
    typeof bundlerSendBundleNowRequestSchema
>["params"]
export type BundlerSetBundlingModeRequestParams = z.infer<
    typeof bundlerSetBundlingModeRequestSchema
>["params"]
export type BundlerSetReputationsRequestParams = z.infer<
    typeof bundlerSetReputationsRequestSchema
>["params"]
export type BundlerDumpReputationsRequestParams = z.infer<
    typeof bundlerDumpReputationsRequestSchema
>["params"]
export type BundlerGetStakeStatusRequestParams = z.infer<
    typeof pimlicoGetStakeStatusRequestSchema
>["params"]
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
    bundlerClearStateRequestSchema,
    bundlerClearMempoolRequestSchema,
    bundlerDumpMempoolRequestSchema,
    bundlerSendBundleNowRequestSchema,
    bundlerSetBundlingModeRequestSchema,
    bundlerSetReputationsRequestSchema,
    bundlerDumpReputationsRequestSchema,
    pimlicoGetStakeStatusRequestSchema,
    pimlicoGetUserOperationStatusRequestSchema,
    pimlicoGetUserOperationGasPriceRequestSchema,
    bundlerRequestSchema,
    jsonRpcSchema,
    jsonRpcResultSchema,
    userOperationSchema
}

export {
    bundlerClearStateResponseSchema,
    bundlerClearMempoolResponseSchema,
    bundlerDumpMempoolResponseSchema,
    bundlerGetStakeStatusResponseSchema,
    bundlerSendBundleNowResponseSchema,
    bundlerSetBundlingModeResponseSchema,
    bundlerSetReputationsResponseSchema,
    bundlerDumpReputationsResponseSchema,
    pimlicoGetUserOperationStatusResponseSchema,
    pimlicoGetUserOperationGasPriceResponseSchema,
    bundlerResponseSchema
}

export {
    addressSchema,
    hexData32Schema,
    hexDataSchema,
    logSchema,
    receiptSchema
}
