import {
    getUserOperationHash,
    isVersion06,
    parseUserOperationReceipt
} from "@alto/utils"
import { createMethodHandler } from "../types"
import {
    RpcError,
    UserOpInfo,
    UserOperationBundle,
    ValidationErrors,
    pimlicoSendUserOperationNowSchema
} from "@alto/types"

export const pimlicoSendUserOperationNowHandler = createMethodHandler({
    schema: pimlicoSendUserOperationNowSchema,
    handler: async ({ relay, params, meta }) => {
        if (!relay.config.enableInstantBundlingEndpoint) {
            throw new RpcError(
                "pimlico_sendUserOperationNow endpoint is not enabled",
                ValidationErrors.InvalidFields
            )
        }

        const [userOperation, entryPoint] = params
        const { apiVersion } = meta

        relay.ensureEntryPointIsSupported(entryPoint)
        const opHash = getUserOperationHash(
            userOperation,
            entryPoint,
            relay.config.publicClient.chain.id
        )

        await relay.preMempoolChecks(
            opHash,
            userOperation,
            apiVersion,
            entryPoint
        )

        // Prepare bundle
        const userOperationInfo: UserOpInfo = {
            userOp: userOperation,
            entryPoint,
            userOpHash: getUserOperationHash(
                userOperation,
                entryPoint,
                relay.config.publicClient.chain.id
            ),
            addedToMempool: Date.now()
        }
        const bundle: UserOperationBundle = {
            entryPoint,
            userOps: [userOperationInfo],
            version: isVersion06(userOperation)
                ? ("0.6" as const)
                : ("0.7" as const)
        }
        const result = await relay.executorManager.sendBundleToExecutor(bundle)

        if (!result) {
            throw new RpcError(
                "unhandled error during bundle submission",
                ValidationErrors.InvalidFields
            )
        }

        // Wait for receipt.
        const receipt =
            await relay.config.publicClient.waitForTransactionReceipt({
                hash: result,
                pollingInterval: 100
            })

        return parseUserOperationReceipt(opHash, receipt)
    }
})
