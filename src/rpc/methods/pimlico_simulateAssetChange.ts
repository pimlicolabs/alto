import { createMethodHandler } from "../createMethodHandler"
import {
    EntryPointV07SimulationsAbi,
    PimlicoEntryPointSimulationsAbi,
    RpcError,
    UserOperationV07,
    pimlicoSimulateAssetChangeSchema
} from "@alto/types"
import { createMemoryClient, http } from "tevm"
import { optimism as tevmOptimism } from "tevm/common"
import { encodeFunctionData } from "viem"
import { isVersion06, toPackedUserOperation } from "../../utils/userop"
import type { AltoConfig } from "../../esm/createConfig"

async function setupTevm(config: AltoConfig, blockNumber?: bigint) {
    const options = {
        fork: {
            transport: http(config.rpcUrl),
            ...(blockNumber !== undefined
                ? { blockNumber }
                : { blockTag: "latest" as const })
        },
        ...(config.chainType === "op-stack" ? { common: tevmOptimism } : {})
    }
    return createMemoryClient(options)
}

export const pimlicoSimulateAssetChangeHandler = createMethodHandler({
    method: "pimlico_simulateAssetChange",
    schema: pimlicoSimulateAssetChangeSchema,
    handler: async ({ rpcHandler, params }) => {
        rpcHandler.logger.error("called pimlico_simulateAssetChange")
        const { config } = rpcHandler
        const [userOperation, entryPoint, blockNumber] = params

        // Validations
        if (isVersion06(userOperation)) {
            throw new RpcError(
                "pimlico_simulateAssetChange is not supported for v0.6"
            )
        }

        if (!config.entrypointSimulationContract) {
            throw new RpcError("Missing entryPoint simulations contract")
        }

        const tevmClient = await setupTevm(config, blockNumber)

        // Create simulation calldata + call tevmCall with tracing
        const userOp = userOperation as UserOperationV07
        const callData = encodeFunctionData({
            abi: PimlicoEntryPointSimulationsAbi,
            functionName: "simulateEntryPoint",
            args: [
                entryPoint,
                [
                    encodeFunctionData({
                        abi: EntryPointV07SimulationsAbi,
                        functionName: "simulateHandleOp",
                        args: [toPackedUserOperation(userOp)]
                    })
                ]
            ]
        })

        const callResult = await tevmClient.tevmCall({
            to: config.entrypointSimulationContract,
            data: callData,
            createTrace: true,
            createAccessList: true
        })

        // Process results
        const structLogs = callResult.trace?.structLogs

        if (!structLogs) {
            rpcHandler.logger.error("No struct logs found")
            throw new Error("No struct logs found")
        }

        // Process struct logs to find anytime a ERC20 / ERC721 transfer is made
        // For ERC20 transfers we check for `transfer(address,uint256)` and `transferFrom(address,address,uint256)`
        // For ERC721 transfers we check for `safeTransferFrom(address,address,uint256)`
        const logs = structLogs.map((structLog) => {
            if (structLog.op !== "CALL") {
                return
            }

            console.log(structLog)
        })

        //console.log({ trace: callResult.trace })
        //console.log({ accessList: callResult.accessList })

        throw new Error("Not implemented")
    }
})
