import {
    ERC7769Errors,
    RpcError,
    pimlicoPrepareUserOperationSchema
} from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"
import { getBoostedUserOpError } from "./boost_sendUserOperation"
import {
    createInstantBundle,
    isBoostedUserOp,
    validateInstantUserOp
} from "./pimlico_sendUserOperationNow"

// Runs the checks and the simulation of pimlico_sendUserOperationNow without
// sending. pimlico_sendPreparedUserOperation then only takes an executor,
// signs and sends.
export const pimlicoPrepareUserOperationHandler = createMethodHandler({
    method: "pimlico_prepareUserOperation",
    schema: pimlicoPrepareUserOperationSchema,
    handler: async ({ rpcHandler, params, apiVersion }) => {
        if (!rpcHandler.config.enableInstantBundlingEndpoint) {
            throw new RpcError(
                "pimlico_prepareUserOperation endpoint is not enabled",
                ERC7769Errors.InvalidFields
            )
        }
        if (rpcHandler.config.skipInstantBundling) {
            throw new RpcError(
                "pimlico_prepareUserOperation is not available, use pimlico_sendUserOperationNow",
                ERC7769Errors.InvalidFields
            )
        }

        const [userOp, entryPoint] = params
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        const isBoosted = isBoostedUserOp(userOp)
        if (isBoosted) {
            const boostedUserOpError = getBoostedUserOpError({ userOp })
            if (boostedUserOpError) {
                throw new RpcError(
                    boostedUserOpError,
                    ERC7769Errors.InvalidFields
                )
            }
        }

        const userOpError = await validateInstantUserOp({
            rpcHandler,
            userOp,
            entryPoint,
            apiVersion,
            isBoosted
        })
        if (userOpError) {
            throw new RpcError(userOpError, ERC7769Errors.InvalidFields)
        }

        const bundle = createInstantBundle({ rpcHandler, userOp, entryPoint })
        const [{ userOpHash }] = bundle.userOps
        const { preparedUserOps } = rpcHandler

        if (!preparedUserOps.reserve(userOpHash)) {
            throw new RpcError(
                "userOperation is already prepared",
                ERC7769Errors.InvalidFields
            )
        }

        await rpcHandler.mempool.store.addProcessing({
            entryPoint,
            userOpInfos: bundle.userOps
        })

        const unprepare = async () => {
            preparedUserOps.unreserve(userOpHash)
            await rpcHandler.mempool.removeProcessing({
                entryPoint,
                userOps: bundle.userOps
            })
        }

        const filterOpsResult = await rpcHandler.executorManager
            .simulateBundle(bundle)
            .catch(async (err: unknown) => {
                await unprepare()
                throw err
            })

        if (filterOpsResult.status === "all_ops_rejected") {
            await unprepare()
            const reason =
                filterOpsResult.rejectedUserOps[0]?.reason ?? "unknown"
            throw new RpcError(
                `userOperation simulation failed: ${reason}`,
                ERC7769Errors.InvalidFields
            )
        }

        if (filterOpsResult.status !== "success") {
            await unprepare()
            throw new Error("internal error while simulating the userOperation")
        }

        const id = preparedUserOps.add({ bundle, filterOpsResult })
        return { id, userOpHash }
    }
})
