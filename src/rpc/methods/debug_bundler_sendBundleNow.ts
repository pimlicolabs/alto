import { createMethodHandler } from "../types"
import { bundlerSendBundleNowSchema } from "@alto/types"

export const debugBundlerSendBundleNowHandler = createMethodHandler({
    method: "debug_bundler_sendBundleNow",
    schema: bundlerSendBundleNowSchema.shape.params,
    responseSchema: bundlerSendBundleNowSchema.shape.result,
    handler: async ({ relay }) => {
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_sendBundleNow")
        await relay.executorManager.sendBundleNow()

        return "ok" as const
    }
})
