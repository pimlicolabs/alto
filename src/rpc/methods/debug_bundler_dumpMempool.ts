import { debugDumpMempoolSchema } from "@alto/types"
import { createMethodHandler } from "../createMethodHandler"

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
