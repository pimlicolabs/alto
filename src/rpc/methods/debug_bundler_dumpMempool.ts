import { createMethodHandler } from "../createMethodHandler"
import { debugDumpMempoolSchema } from "@alto/types"

export const debugBundlerDumpMempoolHandler = createMethodHandler({
    schema: debugDumpMempoolSchema,
    method: "debug_bundler_dumpMempool",
    handler: async ({ rpcHandler, params }) => {
        const [entryPoint] = params
        rpcHandler.ensureDebugEndpointsAreEnabled("debug_bundler_dumpMempool")
        rpcHandler.ensureEntryPointIsSupported(entryPoint)

        return (await rpcHandler.mempool.dumpOutstanding(entryPoint)).map(
            ({ userOp }) => userOp
        )
    }
})
