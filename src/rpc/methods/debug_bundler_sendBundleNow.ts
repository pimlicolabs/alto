import { createMethodHandler } from "../createMethodHandler"
import { debugSendBundleNowSchema } from "@alto/types"

export const debugBundlerSendBundleNowHandler = createMethodHandler({
    method: "debug_bundler_sendBundleNow",
    schema: debugSendBundleNowSchema,
    handler: async ({ rpcHandler }) => {
        rpcHandler.ensureDebugEndpointsAreEnabled("debug_bundler_sendBundleNow")
        await rpcHandler.executorManager.sendBundleNow()

        return "ok" as const
    }
})
