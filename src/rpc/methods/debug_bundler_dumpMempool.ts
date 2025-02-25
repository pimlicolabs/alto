import { createMethodHandler } from "../types"
import { bundlerDumpMempoolSchema } from "@alto/types"

export const debugBundlerDumpMempoolHandler = createMethodHandler({
    schema: bundlerDumpMempoolSchema,
    handler: async ({ relay, params }) => {
        const [entryPoint] = params
        relay.ensureDebugEndpointsAreEnabled("debug_bundler_dumpMempool")
        relay.ensureEntryPointIsSupported(entryPoint)

        return Promise.resolve(relay.mempool.dumpOutstanding())
    }
})
