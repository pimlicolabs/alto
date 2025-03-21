import type { RpcHandler } from "../rpcHandler"
import { ethChainIdHandler } from "./eth_chainId"
import { ethEstimateUserOperationGasHandler } from "./eth_estimateUserOperationGas"
import { ethGetUserOperationByHashHandler } from "./eth_getUserOperationByHash"
import { ethGetUserOperationReceiptHandler } from "./eth_getUserOperationReceipt"
import { ethSendUserOperationHandler } from "./eth_sendUserOperation"
import { ethSupportedEntryPointsHandler } from "./eth_supportedEntryPoints"
import { debugClearReputationHandler } from "./debug_bundler_clearReputation"
import { debugBundlerClearStateHandler } from "./debug_bundler_clearState"
import { debugBundlerDumpMempoolHandler } from "./debug_bundler_dumpMempool"
import { debugBundlerDumpReputationHandler } from "./debug_bundler_dumpReputation"
import { debugGetStakeStatusHandler } from "./debug_bundler_getStakeStatus"
import { debugBundlerSendBundleNowHandler } from "./debug_bundler_sendBundleNow"
import { debugBundlerSetBundlingModeHandler } from "./debug_bundler_setBundlingMode"
import { debugSetReputationHandler } from "./debug_bundler_setReputation"
import { pimlicoGetUserOperationGasPriceHandler } from "./pimlico_getUserOperationGasPrice"
import { pimlicoGetUserOperationStatusHandler } from "./pimlico_getUserOperationStatus"
import { pimlicoSendUserOperationNowHandler } from "./pimlico_sendUserOperationNow"

export function registerHandlers(rpcHandler: RpcHandler) {
    // eth_* namespace
    rpcHandler.registerHandler(ethChainIdHandler)
    rpcHandler.registerHandler(ethEstimateUserOperationGasHandler)
    rpcHandler.registerHandler(ethGetUserOperationByHashHandler)
    rpcHandler.registerHandler(ethGetUserOperationReceiptHandler)
    rpcHandler.registerHandler(ethSendUserOperationHandler)
    rpcHandler.registerHandler(ethSupportedEntryPointsHandler)

    // bundler_debug_* namespace
    rpcHandler.registerHandler(debugClearReputationHandler)
    rpcHandler.registerHandler(debugBundlerClearStateHandler)
    rpcHandler.registerHandler(debugBundlerDumpMempoolHandler)
    rpcHandler.registerHandler(debugBundlerDumpReputationHandler)
    rpcHandler.registerHandler(debugGetStakeStatusHandler)
    rpcHandler.registerHandler(debugBundlerSendBundleNowHandler)
    rpcHandler.registerHandler(debugBundlerSetBundlingModeHandler)
    rpcHandler.registerHandler(debugSetReputationHandler)

    // pimlico_* namespace
    rpcHandler.registerHandler(pimlicoGetUserOperationGasPriceHandler)
    rpcHandler.registerHandler(pimlicoGetUserOperationStatusHandler)
    rpcHandler.registerHandler(pimlicoSendUserOperationNowHandler)
}
