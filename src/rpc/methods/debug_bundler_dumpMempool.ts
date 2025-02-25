import { createMethodHandler } from "../types"
import { bundlerDumpMempoolSchema } from "@alto/types"

export const debugBundlerDumpMempoolHandler = createMethodHandler({
    method: "debug_bundler_dumpMempool",
    schema: bundlerDumpMempoolSchema.shape.params,
    responseSchema: bundlerDumpMempoolSchema.shape.result,
    handler: async ({ relay, params }) => {
        const [entryPoint] = params
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_dumpMempool")
        relay.ensureEntryPointIsSupported(entryPoint)

        return Promise.resolve(relay.mempool.dumpOutstanding())
    }
})
