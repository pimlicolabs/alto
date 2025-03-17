import { type Hash, type Hex, getAddress, maxUint256 } from "viem"
import { z } from "zod"
import { initializeZodErrorMap } from "./errors"

// Initialize the custom error map
initializeZodErrorMap()

const hexDataPattern = /^0x[0-9A-Fa-f]*$/
const addressPattern = /^0x[0-9,a-f,A-F]{40}$/
export const hexData32Pattern = /^0x([0-9a-fA-F][0-9a-fA-F]){32}$/
export const commaSeperatedAddressPattern =
    /^(0x[0-9a-fA-F]{40})(,\s*(0x[0-9a-fA-F]{40}))*$/

export const addressSchema = z
    .string()
    .regex(addressPattern, { message: "not a valid hex address" })
    .transform((val) => getAddress(val))

export const hexNumberSchema = z
    .string()
    .regex(hexDataPattern)
    .or(z.number())
    .or(z.bigint())
    .transform((val) => BigInt(val))
    .refine((val) => val <= maxUint256, {
        message: "not a valid uint256"
    })

export const hexDataSchema = z
    .string()
    .regex(hexDataPattern, { message: "not valid hex data" })
    .transform((val) => val as Hex)

export const hexData32Schema = z
    .string()
    .regex(hexData32Pattern, { message: "not valid 32-byte hex data" })
    .transform((val) => val as Hash)

export const stateOverridesSchema = z.record(
    addressSchema,
    z.object({
        balance: hexNumberSchema.optional(),
        nonce: hexNumberSchema.optional(),
        code: hexDataSchema.optional(),
        state: z.record(hexData32Schema, hexData32Schema).optional(),
        stateDiff: z.record(hexData32Schema, hexData32Schema).optional()
    })
)

export type Address = z.infer<typeof addressSchema>
export type HexNumber = z.infer<typeof hexNumberSchema>
export type HexData = z.infer<typeof hexDataSchema>
export type HexData32 = z.infer<typeof hexData32Schema>
export type StateOverrides = z.infer<typeof stateOverridesSchema>

const signedAuthorizationSchema = z.object({
    contractAddress: addressSchema,
    chainId: hexNumberSchema.transform((val) => Number(val)),
    nonce: hexNumberSchema.transform((val) => Number(val)),
    r: hexData32Schema.transform((val) => val as Hex),
    s: hexData32Schema.transform((val) => val as Hex),
    v: hexNumberSchema,
    yParity: hexNumberSchema.transform((val) => Number(val))
})

const userOperationV06Schema = z
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
        eip7702Auth: signedAuthorizationSchema.optional().nullable()
    })
    .strict()
    .transform((val) => {
        return val
    })

const userOperationV07Schema = z
    .object({
        sender: addressSchema,
        nonce: hexNumberSchema,
        factory: addressSchema
            .nullable()
            .optional()
            .transform((val) => val ?? null),
        factoryData: hexDataSchema
            .nullable()
            .optional()
            .transform((val) => val ?? null),
        callData: hexDataSchema,
        callGasLimit: hexNumberSchema,
        verificationGasLimit: hexNumberSchema,
        preVerificationGas: hexNumberSchema,
        maxFeePerGas: hexNumberSchema,
        maxPriorityFeePerGas: hexNumberSchema,
        paymaster: addressSchema
            .nullable()
            .optional()
            .transform((val) => val ?? null),
        paymasterVerificationGasLimit: hexNumberSchema
            .nullable()
            .optional()
            .transform((val) => val ?? null),
        paymasterPostOpGasLimit: hexNumberSchema
            .nullable()
            .optional()
            .transform((val) => val ?? null),
        paymasterData: hexDataSchema
            .nullable()
            .optional()
            .transform((val) => val ?? null),
        signature: hexDataSchema,
        eip7702Auth: signedAuthorizationSchema.optional().nullable()
    })
    .strict()
    .transform((val) => val)

const partialUserOperationV06Schema = z
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
        signature: hexDataSchema,
        eip7702Auth: signedAuthorizationSchema.optional().nullable()
    })
    .strict()
    .transform((val) => {
        return val
    })

const partialUserOperationV07Schema = z
    .object({
        sender: addressSchema,
        nonce: hexNumberSchema,
        factory: addressSchema
            .nullable()
            .optional()
            .transform((val) => val ?? null),
        factoryData: hexDataSchema
            .nullable()
            .optional()
            .transform((val) => val ?? null),
        callData: hexDataSchema,
        callGasLimit: hexNumberSchema.default(1n),
        verificationGasLimit: hexNumberSchema.default(1n),
        preVerificationGas: hexNumberSchema.default(1n),
        maxFeePerGas: hexNumberSchema.default(1n),
        maxPriorityFeePerGas: hexNumberSchema.default(1n),
        paymaster: addressSchema
            .nullable()
            .optional()
            .transform((val) => val ?? null),
        paymasterVerificationGasLimit: hexNumberSchema
            .nullable()
            .optional()
            .transform((val) => val ?? null),
        paymasterPostOpGasLimit: hexNumberSchema
            .nullable()
            .optional()
            .transform((val) => val ?? null),
        paymasterData: hexDataSchema
            .nullable()
            .optional()
            .transform((val) => val ?? null),
        signature: hexDataSchema,
        eip7702Auth: signedAuthorizationSchema.optional().nullable()
    })
    .strict()
    .transform((val) => val)

const packerUserOperationSchema = z
    .object({
        sender: addressSchema,
        nonce: hexNumberSchema,
        initCode: hexDataSchema,
        callData: hexDataSchema,
        accountGasLimits: hexData32Schema,
        preVerificationGas: hexNumberSchema,
        gasFees: hexData32Schema,
        paymasterAndData: hexDataSchema,
        signature: hexDataSchema
    })
    .strict()
    .transform((val) => val)

const partialUserOperationSchema = z.union([
    partialUserOperationV06Schema,
    partialUserOperationV07Schema
])

const userOperationSchema = z.union([
    userOperationV06Schema,
    userOperationV07Schema
])

export type UserOperationV06 = z.infer<typeof userOperationV06Schema>
export type UserOperationV07 = z.infer<typeof userOperationV07Schema>
export type PackedUserOperation = z.infer<typeof packerUserOperationSchema>
export type UserOperation = z.infer<typeof userOperationSchema>

export const jsonRpcSchema = z
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

export const logSchema = z.object({
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

export const receiptSchema = z.object({
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
    effectiveGasPrice: hexNumberSchema.nullish()
    //type: hexNumberSchema
})

const userOperationReceiptSchema = z
    .object({
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
    .or(z.null())

export type UserOperationReceipt = z.infer<typeof userOperationReceiptSchema>

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

// Combined schemas (request + response)
export const chainIdSchema = z.object({
    method: z.literal("eth_chainId"),
    params: z.tuple([]),
    result: hexNumberSchema
})

export const supportedEntryPointsSchema = z.object({
    method: z.literal("eth_supportedEntryPoints"),
    params: z.tuple([]),
    result: z.array(addressSchema)
})

export const estimateUserOperationGasSchema = z.object({
    method: z.literal("eth_estimateUserOperationGas"),
    params: z.array(z.unknown())
        .min(2, "Missing entryPoint: You must provide a valid entryPoint address as the second parameter")
        .pipe(
            z.union([
                z.tuple([
                    partialUserOperationSchema,
                    addressSchema.describe("entryPoint")
                ]),
                z.tuple([
                    partialUserOperationSchema,
                    addressSchema.describe("entryPoint"),
                    stateOverridesSchema
                ])
            ])
        ),
    result: z.union([
        z.object({
            callGasLimit: hexNumberSchema,
            preVerificationGas: hexNumberSchema,
            verificationGasLimit: hexNumberSchema,
            verificationGas: hexNumberSchema.optional()
        }),
        z.object({
            callGasLimit: hexNumberSchema,
            preVerificationGas: hexNumberSchema,
            verificationGasLimit: hexNumberSchema,
            paymasterVerificationGasLimit: hexNumberSchema.optional(),
            paymasterPostOpGasLimit: hexNumberSchema.optional()
        })
    ])
})

export const sendUserOperationSchema = z.object({
    method: z.literal("eth_sendUserOperation"),
    params: z.array(z.unknown())
        .min(2, "Missing entryPoint: You must provide a valid entryPoint address as the second parameter")
        .pipe(
            z.tuple([
                userOperationSchema,
                addressSchema.describe("entryPoint")
            ])
        ),
    result: hexData32Schema
})

export const getUserOperationByHashSchema = z.object({
    method: z.literal("eth_getUserOperationByHash"),
    params: z.tuple([
        z
            .string()
            .regex(hexData32Pattern, { message: "Missing/invalid userOpHash" })
            .transform((val) => val as Hex)
    ]),
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

export const getUserOperationReceiptSchema = z.object({
    method: z.literal("eth_getUserOperationReceipt"),
    params: z.tuple([
        z
            .string()
            .regex(hexData32Pattern, { message: "Missing/invalid userOpHash" })
            .transform((val) => val as Hex)
    ]),
    result: userOperationReceiptSchema
})

export const debugClearStateSchema = z.object({
    method: z.literal("debug_bundler_clearState"),
    params: z.tuple([]),
    result: z.literal("ok")
})

export const debugClearMempoolSchema = z.object({
    method: z.literal("debug_bundler_clearMempool"),
    params: z.tuple([]),
    result: z.literal("ok")
})

export const debugDumpMempoolSchema = z.object({
    method: z.literal("debug_bundler_dumpMempool"),
    params: z.array(z.unknown())
        .min(1, "Missing entryPoint: You must provide a valid entryPoint address as the parameter")
        .pipe(
            z.tuple([addressSchema.describe("entryPoint")])
        ),
    result: z.array(userOperationSchema)
})

export const debugSendBundleNowSchema = z.object({
    method: z.literal("debug_bundler_sendBundleNow"),
    params: z.tuple([]),
    result: z.literal("ok")
})

export const debugSetBundlingModeSchema = z.object({
    method: z.literal("debug_bundler_setBundlingMode"),
    params: z.tuple([z.enum(["manual", "auto"])]),
    result: z.literal("ok")
})

export const debugSetReputationSchema = z.object({
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
    ]),
    result: z.literal("ok")
})

export const debugDumpReputationSchema = z.object({
    method: z.literal("debug_bundler_dumpReputation"),
    params: z.array(z.unknown())
        .min(1, "Missing entryPoint: You must provide a valid entryPoint address as the parameter")
        .pipe(
            z.tuple([addressSchema.describe("entryPoint")])
        ),
    result: z.array(
        z.object({
            address: addressSchema,
            opsSeen: hexNumberSchema,
            opsIncluded: hexNumberSchema,
            status: hexNumberSchema.optional()
        })
    )
})

export const debugClearReputationSchema = z.object({
    method: z.literal("debug_bundler_clearReputation"),
    params: z.tuple([]),
    result: z.literal("ok")
})

export const debugGetStakeStatusSchema = z.object({
    method: z.literal("debug_bundler_getStakeStatus"),
    params: z.array(z.unknown())
        .min(2, "Missing parameters: You must provide a valid account address and entryPoint address")
        .pipe(
            z.tuple([
                addressSchema.describe("account"),
                addressSchema.describe("entryPoint")
            ])
        ),
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

export const pimlicoGetUserOperationStatusSchema = z.object({
    method: z.literal("pimlico_getUserOperationStatus"),
    params: z.tuple([hexData32Schema]),
    result: userOperationStatus
})

export const pimlicoGetUserOperationGasPriceSchema = z.object({
    method: z.literal("pimlico_getUserOperationGasPrice"),
    params: z.tuple([]),
    result: gasPriceSchema
})

export const pimlicoSendUserOperationNowSchema = z.object({
    method: z.literal("pimlico_sendUserOperationNow"),
    params: z.array(z.unknown())
        .min(2, "Missing entryPoint: You must provide a valid entryPoint address as the second parameter")
        .pipe(
            z.tuple([
                userOperationSchema,
                addressSchema.describe("entryPoint")
            ])
        ),
    result: userOperationReceiptSchema
})

export const pimlicoExperimentalEstimateUserOperationGas7702Schema = z.object({
    method: z.literal("pimlico_experimental_estimateUserOperationGas7702"),
    params: z.array(z.unknown())
        .min(2, "Missing entryPoint: You must provide a valid entryPoint address as the second parameter")
        .pipe(
            z.union([
                z.tuple([
                    partialUserOperationSchema,
                    addressSchema.describe("entryPoint")
                ]),
                z.tuple([
                    partialUserOperationSchema,
                    addressSchema.describe("entryPoint"),
                    stateOverridesSchema
                ])
            ])
        ),
    result: z.union([
        z.object({
            callGasLimit: hexNumberSchema,
            preVerificationGas: hexNumberSchema,
            verificationGasLimit: hexNumberSchema,
            verificationGas: hexNumberSchema.optional()
        }),
        z.object({
            callGasLimit: hexNumberSchema,
            preVerificationGas: hexNumberSchema,
            verificationGasLimit: hexNumberSchema,
            paymasterVerificationGasLimit: hexNumberSchema.optional(),
            paymasterPostOpGasLimit: hexNumberSchema.optional()
        })
    ])
})

export const pimlicoExperimentalSendUserOperation7702Schema = z.object({
    method: z.literal("pimlico_experimental_sendUserOperation7702"),
    params: z.array(z.unknown())
        .min(2, "Missing entryPoint: You must provide a valid entryPoint address as the second parameter")
        .pipe(
            z.tuple([
                userOperationSchema,
                addressSchema.describe("entryPoint")
            ])
        ),
    result: hexData32Schema
})

export const altoVersions = z.enum(["v1", "v2"])
export type AltoVersions = z.infer<typeof altoVersions>

// Create request and response discriminated unions from the combined schemas
export const bundlerRequestSchema = z.discriminatedUnion("method", [
    chainIdSchema.omit({ result: true }),
    supportedEntryPointsSchema.omit({ result: true }),
    estimateUserOperationGasSchema.omit({ result: true }),
    sendUserOperationSchema.omit({ result: true }),
    getUserOperationByHashSchema.omit({ result: true }),
    getUserOperationReceiptSchema.omit({ result: true }),
    debugClearStateSchema.omit({ result: true }),
    debugClearMempoolSchema.omit({ result: true }),
    debugDumpMempoolSchema.omit({ result: true }),
    debugSendBundleNowSchema.omit({ result: true }),
    debugSetBundlingModeSchema.omit({ result: true }),
    debugSetReputationSchema.omit({ result: true }),
    debugDumpReputationSchema.omit({ result: true }),
    debugClearReputationSchema.omit({ result: true }),
    debugGetStakeStatusSchema.omit({ result: true }),
    pimlicoGetUserOperationStatusSchema.omit({ result: true }),
    pimlicoGetUserOperationGasPriceSchema.omit({ result: true }),
    pimlicoSendUserOperationNowSchema.omit({ result: true }),
    pimlicoExperimentalSendUserOperation7702Schema.omit({ result: true }),
    pimlicoExperimentalEstimateUserOperationGas7702Schema.omit({
        result: true
    })
])
export type BundlerRequest = z.infer<typeof bundlerRequestSchema>

export const bundlerRpcSchema = z.union([
    chainIdSchema,
    supportedEntryPointsSchema,
    estimateUserOperationGasSchema,
    sendUserOperationSchema,
    getUserOperationByHashSchema,
    getUserOperationReceiptSchema,
    debugClearStateSchema,
    debugClearMempoolSchema,
    debugDumpMempoolSchema,
    debugSendBundleNowSchema,
    debugSetBundlingModeSchema,
    debugSetReputationSchema,
    debugDumpReputationSchema,
    debugClearReputationSchema,
    debugGetStakeStatusSchema,
    pimlicoGetUserOperationStatusSchema,
    pimlicoGetUserOperationGasPriceSchema,
    pimlicoSendUserOperationNowSchema,
    pimlicoExperimentalSendUserOperation7702Schema,
    pimlicoExperimentalEstimateUserOperationGas7702Schema
])

export type BundlingMode = z.infer<
    typeof debugSetBundlingModeSchema
>["params"][0]

// biome-ignore lint/style/useNamingConvention: <explanation>
export type JSONRPCRequest = z.infer<typeof jsonRpcSchema>
// biome-ignore lint/style/useNamingConvention: <explanation>
export type JSONRPCResponse = z.infer<typeof jsonRpcResultSchema>

const OpEventType = z.union([
    z.object({
        eventType: z.literal("received")
    }),
    z.object({
        eventType: z.literal("added_to_mempool")
    }),
    z.object({
        eventType: z.literal("queued")
    }),
    z.object({
        eventType: z.literal("failed_validation"),
        data: z.object({
            reason: z.string().optional(),
            aaError: z.string().optional()
        })
    }),
    z.object({
        eventType: z.literal("dropped"),
        data: z.object({
            reason: z.string().optional(),
            aaError: z.string().optional()
        })
    }),
    z.object({
        eventType: z.literal("submitted"),
        transactionHash: hexData32Schema
    }),
    z.object({
        eventType: z.literal("included_onchain"),
        transactionHash: hexData32Schema,
        data: z.object({
            blockNumber: z.number()
        })
    }),
    z.object({
        eventType: z.literal("frontran_onchain"),
        transactionHash: hexData32Schema,
        data: z.object({
            blockNumber: z.number()
        })
    }),
    z.object({
        eventType: z.literal("failed_onchain"),
        transactionHash: hexData32Schema,
        data: z.object({
            blockNumber: z.number(),
            reason: z.string().optional(),
            aaError: z.string().optional()
        })
    }),
    z.object({
        eventType: z.literal("execution_reverted_onchain"),
        transactionHash: hexData32Schema,
        data: z.object({
            blockNumber: z.number(),
            reason: z.string().optional()
        })
    })
])

export type OpEventType = z.infer<typeof OpEventType>
