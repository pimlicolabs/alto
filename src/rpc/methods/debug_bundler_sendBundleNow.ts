import { debugSendBundleNowSchema } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"

export const debugBundlerSendBundleNowHandler = createMethodHandler({
    method: "debug_bundler_sendBundleNow",
    schema: debugSendBundleNowSchema,
    handler: async ({ rpcHandler }) => {
        rpcHandler.ensureDebugEndpointsAreEnabled("debug_bundler_sendBundleNow")
        await rpcHandler.executorManager.sendBundleNow()

        return "ok" as const
    }
})
