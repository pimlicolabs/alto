import {
    getUserOperationHash,
    isVersion06,
    parseUserOperationReceipt
} from "@alto/utils"
import { createMethodHandler } from "../createMethodHandler"
import {
    RpcError,
    type UserOpInfo,
    type UserOperationBundle,
    ValidationErrors,
    pimlicoSendUserOperationNowSchema
} from "@alto/types"

export const pimlicoSendUserOperationNowHandler = createMethodHandler({
    method: "pimlico_sendUserOperationNow",
    schema: pimlicoSendUserOperationNowSchema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        if (!rpcHandler.config.enableInstantBundlingEndpoint) {
            throw new RpcError(
                "pimlico_sendUserOperationNow endpoint is not enabled",
                ValidationErrors.InvalidFields
            )
        }

        const [userOperation, entryPoint] = params

        rpcHandler.ensureEntryPointIsSupported(entryPoint)
        const opHash = await getUserOperationHash({
            userOperation: userOperation,
            entryPointAddress: entryPoint,
            chainId: rpcHandler.config.chainId,
            publicClient: rpcHandler.config.publicClient
        })

        await rpcHandler.preMempoolChecks(
            opHash,
            userOperation,
            apiVersion,
            entryPoint
        )

        // Prepare bundle
        const userOpInfo: UserOpInfo = {
            userOp: userOperation,
            userOpHash: await getUserOperationHash({
                userOperation: userOperation,
                entryPointAddress: entryPoint,
                chainId: rpcHandler.config.chainId,
                publicClient: rpcHandler.config.publicClient
            }),
            addedToMempool: Date.now(),
            submissionAttempts: 0
        }
        const bundle: UserOperationBundle = {
            entryPoint,
            userOps: [userOpInfo],
            version: isVersion06(userOperation)
                ? ("0.6" as const)
                : ("0.7" as const)
        }
        rpcHandler.mempool.store.addProcessing({ entryPoint, userOpInfo })
        const result =
            await rpcHandler.executorManager.sendBundleToExecutor(bundle)

        if (!result) {
            throw new RpcError(
                "unhandled error during bundle submission",
                ValidationErrors.InvalidFields
            )
        }

        // Wait for receipt.
        const receipt =
            await rpcHandler.config.publicClient.waitForTransactionReceipt({
                hash: result,
                pollingInterval: 100
            })

        return parseUserOperationReceipt(opHash, receipt)
    }
})
