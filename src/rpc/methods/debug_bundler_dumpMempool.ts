import { createMethodHandler } from "../types"
import { debugDumpMempoolSchema } from "@alto/types"

export const debugBundlerDumpMempoolHandler = createMethodHandler({
    schema: debugDumpMempoolSchema,
    method: "debug_bundler_dumpMempool",
    handler: async ({ relay, params }) => {
        const [entryPoint] = params
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_dumpMempool")
        relay.ensureEntryPointIsSupported(entryPoint)

        return Promise.resolve(relay.mempool.dumpOutstanding())
    }
})
