import {
    ERC7769Errors,
    RpcError,
    type UserOpInfo,
    type UserOperationBundle,
    pimlicoSendUserOperationNowSchema
} from "@alto/types"
import {
    getUserOpHash,
    getViemEntryPointVersion,
    parseUserOpReceipt
} from "@alto/utils"
import { createMethodHandler } from "../createMethodHandler"

export const pimlicoSendUserOperationNowHandler = createMethodHandler({
    method: "pimlico_sendUserOperationNow",
    schema: pimlicoSendUserOperationNowSchema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        if (!rpcHandler.config.enableInstantBundlingEndpoint) {
            throw new RpcError(
                "pimlico_sendUserOperationNow endpoint is not enabled",
                ERC7769Errors.InvalidFields
            )
        }

        const [userOp, entryPoint] = params
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        // Reject EIP-7702 userOps if support is disabled
        if (!rpcHandler.config.eip7702Support && userOp.eip7702Auth) {
            throw new RpcError(
                "EIP-7702 user operations are not supported",
                ERC7769Errors.InvalidFields
            )
        }

        // Validate userOp fields (sync - fail fast before expensive async checks)
        const [fieldsValid, fieldsError] = rpcHandler.validateUserOpFields({
            userOp,
            entryPoint
        })
        if (!fieldsValid) {
            throw new RpcError(fieldsError, ERC7769Errors.InvalidFields)
        }

        const userOpHash = getUserOpHash({
            userOp,
            entryPointAddress: entryPoint,
            chainId: rpcHandler.config.chainId
        })

        // Validate gas price (async)
        const [gasPriceValid, gasPriceError] =
            await rpcHandler.validateUserOpGasPrice({ userOp, apiVersion })
        if (!gasPriceValid) {
            throw new RpcError(gasPriceError, ERC7769Errors.InvalidFields)
        }

        // Prepare bundle
        const userOpInfo: UserOpInfo = {
            userOp,
            userOpHash,
            addedToMempool: Date.now(),
            submissionAttempts: 0
        }

        // Derive version.
        const version = getViemEntryPointVersion(userOp, entryPoint)

        const bundle: UserOperationBundle = {
            entryPoint,
            userOps: [userOpInfo],
            version,
            submissionAttempts: 0
        }
        rpcHandler.mempool.store.addProcessing({
            entryPoint,
            userOpInfos: [userOpInfo]
        })
        const result =
            await rpcHandler.executorManager.sendBundleToExecutor(bundle)

        if (!result) {
            throw new RpcError(
                "unhandled error during bundle submission",
                ERC7769Errors.InvalidFields
            )
        }

        // Wait for receipt.
        const receipt =
            await rpcHandler.config.publicClient.waitForTransactionReceipt({
                hash: result,
                pollingInterval: 100
            })

        return parseUserOpReceipt(userOpHash, receipt)
    }
})
