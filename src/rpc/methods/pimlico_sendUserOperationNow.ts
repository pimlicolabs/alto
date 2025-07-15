import {
    RpcError,
    type UserOpInfo,
    type UserOperationBundle,
    ValidationErrors,
    pimlicoSendUserOperationNowSchema
} from "@alto/types"
import {
    getUserOpHash,
    isVersion07,
    isVersion08,
    parseUserOpReceipt
} from "@alto/utils"
import type { EntryPointVersion } from "viem/account-abstraction"
import { createMethodHandler } from "../createMethodHandler"

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

        const [userOp, entryPoint] = params
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        const opHash = await getUserOpHash({
            userOp,
            entryPointAddress: entryPoint,
            chainId: rpcHandler.config.chainId,
            publicClient: rpcHandler.config.publicClient
        })

        const [preMempoolValid, preMempoolError] =
            await rpcHandler.preMempoolChecks(userOp, apiVersion)

        if (!preMempoolValid) {
            throw new RpcError(preMempoolError, ValidationErrors.InvalidFields)
        }

        // Prepare bundle
        const userOpInfo: UserOpInfo = {
            userOp,
            userOpHash: await getUserOpHash({
                userOp,
                entryPointAddress: entryPoint,
                chainId: rpcHandler.config.chainId,
                publicClient: rpcHandler.config.publicClient
            }),
            addedToMempool: Date.now(),
            submissionAttempts: 0
        }

        // Derive version
        let version: EntryPointVersion
        if (isVersion08(userOp, entryPoint)) {
            version = "0.8"
        } else if (isVersion07(userOp)) {
            version = "0.7"
        } else {
            version = "0.6"
        }

        const bundle: UserOperationBundle = {
            entryPoint,
            userOps: [userOpInfo],
            version,
            submissionAttempts: 0
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

        return parseUserOpReceipt(opHash, receipt)
    }
})
