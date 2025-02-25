import { createMethodHandler } from "../types"
import { debugSendBundleNowSchema } from "@alto/types"

export const debugBundlerSendBundleNowHandler = createMethodHandler({
    method: "debug_bundler_sendBundleNow",
    schema: debugSendBundleNowSchema,
    handler: async ({ relay }) => {
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_sendBundleNow")
        await relay.executorManager.sendBundleNow()

        return "ok" as const
    }
})
