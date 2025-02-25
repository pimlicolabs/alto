import { createMethodHandler } from "../types"
import { bundlerSendBundleNowSchema } from "@alto/types"

export const debugBundlerSendBundleNowHandler = createMethodHandler({
    schema: bundlerSendBundleNowSchema,
    handler: async ({ relay }) => {
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_sendBundleNow")
        await relay.executorManager.sendBundleNow()

        return "ok" as const
    }
})
