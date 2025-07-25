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

const chainIdSchema = z.object({
    method: z.literal("eth_chainId"),
    params: z.tuple([]),
    result: hexNumberSchema
})

const supportedEntryPointsSchema = z.object({
    method: z.literal("eth_supportedEntryPoints"),
    params: z.tuple([]),
    result: z.array(addressSchema)
})

const estimateUserOperationGasSchema = z.object({
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

const sendUserOperationSchema = z.object({
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

const boostSendUserOperationSchema = sendUserOperationSchema.extend({
    method: z.literal("boost_sendUserOperation")
})

const getUserOperationByHashSchema = z.object({
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

const getUserOperationReceiptSchema = z.object({
    method: z.literal("eth_getUserOperationReceipt"),
    params: z.tuple([hexData32Schema]),
    result: userOperationReceiptSchema.nullable()
})

const debugClearStateSchema = z.object({
    method: z.literal("debug_bundler_clearState"),
    params: z.tuple([]),
    result: z.literal("ok")
})

const debugClearMempoolSchema = z.object({
    method: z.literal("debug_bundler_clearMempool"),
    params: z.tuple([]),
    result: z.literal("ok")
})

const debugDumpMempoolSchema = z.object({
    method: z.literal("debug_bundler_dumpMempool"),
    params: z.tuple([addressSchema]),
    result: z.array(userOperationSchema)
})

const debugSendBundleNowSchema = z.object({
    method: z.literal("debug_bundler_sendBundleNow"),
    params: z.tuple([]),
    result: z.literal("ok")
})

const debugSetBundlingModeSchema = z.object({
    method: z.literal("debug_bundler_setBundlingMode"),
    params: z.tuple([z.enum(["manual", "auto"])]),
    result: z.literal("ok")
})

type BundlingMode = z.infer<typeof debugSetBundlingModeSchema>["params"][0]

const debugSetReputationSchema = z.object({
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

const debugDumpReputationSchema = z.object({
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

const debugClearReputationSchema = z.object({
    method: z.literal("debug_bundler_clearReputation"),
    params: z.tuple([]),
    result: z.literal("ok")
})

const debugGetStakeStatusSchema = z.object({
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

const pimlicoGetUserOperationStatusSchema = z.object({
    method: z.literal("pimlico_getUserOperationStatus"),
    params: z.tuple([hexData32Schema]),
    result: userOperationStatusSchema
})

const pimlicoGetUserOperationGasPriceSchema = z.object({
    method: z.literal("pimlico_getUserOperationGasPrice"),
    params: z.tuple([]),
    result: gasPriceSchema
})

const pimlicoSendUserOperationNowSchema = z.object({
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

const pimlicoSimulateAssetChangeSchema = z.object({
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
    chainIdSchema.omit({ result: true }),
    supportedEntryPointsSchema.omit({ result: true }),
    estimateUserOperationGasSchema.omit({ result: true }),
    sendUserOperationSchema.omit({ result: true }),
    boostSendUserOperationSchema.omit({ result: true }),
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
    pimlicoSimulateAssetChangeSchema.omit({ result: true })
])

type BundlerRequest = z.infer<typeof bundlerRequestSchema>

const bundlerRpcSchema = z.union([
    chainIdSchema,
    supportedEntryPointsSchema,
    estimateUserOperationGasSchema,
    sendUserOperationSchema,
    boostSendUserOperationSchema,
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
    pimlicoSimulateAssetChangeSchema
])

export {
    chainIdSchema,
    supportedEntryPointsSchema,
    estimateUserOperationGasSchema,
    sendUserOperationSchema,
    boostSendUserOperationSchema,
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
    pimlicoSimulateAssetChangeSchema,
    bundlerRequestSchema,
    bundlerRpcSchema,
    type BundlerRequest,
    type BundlingMode
}
