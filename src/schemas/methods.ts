import z from "zod/v4"
import {
    addressSchema,
    gasPriceSchema,
    hexData32Schema,
    hexNumberSchema,
    userOperationReceiptSchema,
    userOperationStatusSchema
} from "./common"
import { stateOverridesSchema } from "./state-overrides"
import {
    entryPointAwarePartialUserOperationSchema,
    entryPointAwareUserOperationSchema,
    userOperationSchema
} from "./userop"

const chainIdRequestSchema = z.object({
    method: z.literal("eth_chainId"),
    params: z.tuple([]),
    result: hexNumberSchema
})

const supportedEntryPointsRequestSchema = z.object({
    method: z.literal("eth_supportedEntryPoints"),
    params: z.tuple([]),
    result: z.array(addressSchema)
})

const estimateUserOperationGasRequestSchema = z.object({
    method: z.literal("eth_estimateUserOperationGas"),
    params: z
        .tuple([z.looseObject({}), addressSchema, z.looseObject({}).optional()])
        .transform((params) => {
            const [userOp, entryPoint, stateOverrides] = params

            return [{ userOp, entryPoint }, stateOverrides]
        })
        .pipe(
            z.tuple([
                entryPointAwarePartialUserOperationSchema,
                stateOverridesSchema.optional()
            ])
        )
        .transform((validated) => {
            const [discriminated, stateOverrides] = validated

            return [
                discriminated.userOp,
                discriminated.entryPoint,
                stateOverrides
            ] as const
        }),
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

const sendUserOperationRequestSchema = z.object({
    method: z.literal("eth_sendUserOperation"),
    params: z
        .tuple([z.looseObject({}), addressSchema])
        .transform((params) => {
            const [userOp, entryPoint] = params

            return [{ userOp, entryPoint }]
        })
        .pipe(z.tuple([entryPointAwareUserOperationSchema]))
        .transform((validated) => {
            const [discriminated] = validated

            return [discriminated.userOp, discriminated.entryPoint] as const
        }),
    jsonrpc: z.literal("2.0"),
    id: z.number(),
    result: hexData32Schema
})

const boostSendUserOperationRequestSchema =
    sendUserOperationRequestSchema.extend({
        method: z.literal("boost_sendUserOperation")
    })

const getUserOperationByHashRequestSchema = z.object({
    method: z.literal("eth_getUserOperationByHash"),
    params: z.tuple([hexData32Schema]),
    result: z
        .object({
            userOperation: userOperationSchema,
            entryPoint: addressSchema,
            blockNumber: hexNumberSchema,
            blockHash: hexData32Schema,
            transactionHash: hexData32Schema
        })
        .nullable()
})

const getUserOperationReceiptRequestSchema = z.object({
    method: z.literal("eth_getUserOperationReceipt"),
    params: z.tuple([hexData32Schema]),
    result: userOperationReceiptSchema.nullable()
})

const debugClearStateRequestSchema = z.object({
    method: z.literal("debug_bundler_clearState"),
    params: z.tuple([]),
    result: z.literal("ok")
})

const debugClearMempoolRequestSchema = z.object({
    method: z.literal("debug_bundler_clearMempool"),
    params: z.tuple([]),
    result: z.literal("ok")
})

const debugDumpMempoolRequestSchema = z.object({
    method: z.literal("debug_bundler_dumpMempool"),
    params: z.tuple([addressSchema]),
    result: z.array(userOperationSchema)
})

const debugSendBundleNowRequestSchema = z.object({
    method: z.literal("debug_bundler_sendBundleNow"),
    params: z.tuple([]),
    result: z.literal("ok")
})

const debugSetBundlingModeRequestSchema = z.object({
    method: z.literal("debug_bundler_setBundlingMode"),
    params: z.tuple([z.enum(["manual", "auto"])]),
    result: z.literal("ok")
})

type BundlingMode = z.infer<
    typeof debugSetBundlingModeRequestSchema
>["params"][0]

const debugSetReputationRequestSchema = z.object({
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

const debugDumpReputationRequestSchema = z.object({
    method: z.literal("debug_bundler_dumpReputation"),
    params: z.tuple([addressSchema]),
    result: z.array(
        z.object({
            address: addressSchema,
            opsSeen: hexNumberSchema,
            opsIncluded: hexNumberSchema,
            status: hexNumberSchema.optional()
        })
    )
})

const debugClearReputationRequestSchema = z.object({
    method: z.literal("debug_bundler_clearReputation"),
    params: z.tuple([]),
    result: z.literal("ok")
})

const debugGetStakeStatusRequestSchema = z.object({
    method: z.literal("debug_bundler_getStakeStatus"),
    params: z.tuple([addressSchema, addressSchema]),
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

const pimlicoGetUserOperationStatusRequestSchema = z.object({
    method: z.literal("pimlico_getUserOperationStatus"),
    params: z.tuple([hexData32Schema]),
    result: userOperationStatusSchema
})

const pimlicoGetUserOperationGasPriceRequestSchema = z.object({
    method: z.literal("pimlico_getUserOperationGasPrice"),
    params: z.tuple([]),
    result: gasPriceSchema
})

const pimlicoSendUserOperationNowRequestSchema = z.object({
    method: z.literal("pimlico_sendUserOperationNow"),
    params: z
        .tuple([z.looseObject({}), addressSchema])
        .transform((params) => {
            const [userOp, entryPoint] = params

            return [{ userOp, entryPoint }]
        })
        .pipe(z.tuple([entryPointAwareUserOperationSchema]))
        .transform((validated) => {
            const [discriminated] = validated

            return [discriminated.userOp, discriminated.entryPoint] as const
        }),
    result: userOperationReceiptSchema.nullable()
})

const pimlicoSimulateAssetChangeRequestSchema = z.object({
    method: z.literal("pimlico_simulateAssetChange"),
    params: z
        .tuple([
            z.looseObject({}),
            addressSchema,
            z.looseObject({}),
            z.looseObject({}).optional()
        ])
        .transform((params) => {
            const [userOp, entryPoint, trackingParams, stateOverrides] = params

            return [{ userOp, entryPoint }, trackingParams, stateOverrides]
        })
        .pipe(
            z.tuple([
                entryPointAwareUserOperationSchema,
                z.object({
                    addresses: z.array(addressSchema),
                    tokens: z.array(addressSchema)
                }),
                stateOverridesSchema.optional()
            ])
        )
        .transform((validated) => {
            const [discriminated, trackingParams, stateOverrides] = validated

            return [
                discriminated.userOp,
                discriminated.entryPoint,
                trackingParams,
                stateOverrides
            ] as const
        }),
    result: z.array(
        z.object({
            address: addressSchema,
            token: addressSchema,
            balanceBefore: hexNumberSchema,
            balanceAfter: hexNumberSchema
        })
    )
})

const bundlerRequestSchema = z.discriminatedUnion("method", [
    chainIdRequestSchema.omit({ result: true }),
    supportedEntryPointsRequestSchema.omit({ result: true }),
    estimateUserOperationGasRequestSchema.omit({ result: true }),
    sendUserOperationRequestSchema.omit({ result: true }),
    boostSendUserOperationRequestSchema.omit({ result: true }),
    getUserOperationByHashRequestSchema.omit({ result: true }),
    getUserOperationReceiptRequestSchema.omit({ result: true }),
    debugClearStateRequestSchema.omit({ result: true }),
    debugClearMempoolRequestSchema.omit({ result: true }),
    debugDumpMempoolRequestSchema.omit({ result: true }),
    debugSendBundleNowRequestSchema.omit({ result: true }),
    debugSetBundlingModeRequestSchema.omit({ result: true }),
    debugSetReputationRequestSchema.omit({ result: true }),
    debugDumpReputationRequestSchema.omit({ result: true }),
    debugClearReputationRequestSchema.omit({ result: true }),
    debugGetStakeStatusRequestSchema.omit({ result: true }),
    pimlicoGetUserOperationStatusRequestSchema.omit({ result: true }),
    pimlicoGetUserOperationGasPriceRequestSchema.omit({ result: true }),
    pimlicoSendUserOperationNowRequestSchema.omit({ result: true }),
    pimlicoSimulateAssetChangeRequestSchema.omit({ result: true })
])

type BundlerRequest = z.infer<typeof bundlerRequestSchema>

export {
    chainIdRequestSchema,
    supportedEntryPointsRequestSchema,
    estimateUserOperationGasRequestSchema,
    sendUserOperationRequestSchema,
    boostSendUserOperationRequestSchema,
    getUserOperationByHashRequestSchema,
    getUserOperationReceiptRequestSchema,
    debugClearStateRequestSchema,
    debugClearMempoolRequestSchema,
    debugDumpMempoolRequestSchema,
    debugSendBundleNowRequestSchema,
    debugSetBundlingModeRequestSchema,
    debugSetReputationRequestSchema,
    debugDumpReputationRequestSchema,
    debugClearReputationRequestSchema,
    debugGetStakeStatusRequestSchema,
    pimlicoGetUserOperationStatusRequestSchema,
    pimlicoGetUserOperationGasPriceRequestSchema,
    pimlicoSendUserOperationNowRequestSchema,
    pimlicoSimulateAssetChangeRequestSchema,
    bundlerRequestSchema,
    type BundlerRequest,
    type BundlingMode
}
