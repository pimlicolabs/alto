import { createMethodHandler } from "../createMethodHandler"
import { debugSendBundleNowSchema } from "@alto/schemas"

export const debugBundlerSendBundleNowHandler = createMethodHandler({
    method: "debug_bundler_sendBundleNow",
    schema: debugSendBundleNowSchema,
    handler: async ({ rpcHandler }) => {
        rpcHandler.ensureDebugEndpointsAreEnabled("debug_bundler_sendBundleNow")

        const bundles = await rpcHandler.mempool.getBundles(1)
        const bundle = bundles[0]

        if (bundles.length === 0 || bundle.userOps.length === 0) {
            throw new Error("no userOps in mempool")
        }

        const txHash =
            await rpcHandler.executorManager.sendBundleToExecutor(bundle)

        if (!txHash) {
            throw new Error("no tx hash")
        }

        return "ok" as const
    }
})
