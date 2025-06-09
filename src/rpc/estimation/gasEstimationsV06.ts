import {
    EntryPointV06Abi,
    EntryPointV06SimulationsAbi,
    ValidationErrors,
    executionResultSchema,
    hexDataSchema
} from "@alto/types"
import type { StateOverrides, UserOperationV06 } from "@alto/types"
import type { Hex, RpcRequestErrorType } from "viem"
import {
    type Address,
    decodeErrorResult,
    encodeFunctionData,
    toHex,
    RpcRequestError
} from "viem"
import { z } from "zod"
import type { SimulateHandleOpResult } from "./types"
import type { AltoConfig } from "../../createConfig"
import { parseFailedOpWithRevert } from "./gasEstimationsV07"
import { deepHexlify, getAuthorizationStateOverrides } from "@alto/utils"
import entryPointOverride from "../../contracts/EntryPointSimulations.sol/EntryPointSimulations06.json" with {
    type: "json"
}
import { getSenderCreatorOverride } from "../../utils/entryPointOverrides"

export class GasEstimatorV06 {
    private config: AltoConfig

    constructor(config: AltoConfig) {
        this.config = config
    }

    decodeSimulateHandleOpResult(data: Hex): SimulateHandleOpResult {
        if (data === "0x") {
            return {
                result: "failed",
                data: "AA23 reverted: UserOperation called non-existant contract, or reverted with 0x",
                code: ValidationErrors.SimulateValidation
            }
        }

        const decodedError = decodeErrorResult({
            abi: [...EntryPointV06Abi, ...EntryPointV06SimulationsAbi],
            data
        })

        if (
            decodedError &&
            decodedError.errorName === "FailedOp" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: decodedError.args[1] as string
            } as const
        }

        // custom error thrown by entryPoint if code override is used
        if (
            decodedError &&
            decodedError.errorName === "CallPhaseReverted" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: decodedError.args[0]
            } as const
        }

        // custom error thrown by entryPoint if code override is used
        if (
            decodedError &&
            decodedError.errorName === "FailedOpWithRevert" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: `${decodedError.args?.[1]} ${parseFailedOpWithRevert(
                    decodedError.args?.[2] as Hex
                )}`
            } as const
        }

        if (
            decodedError &&
            decodedError.errorName === "Error" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: decodedError.args[0]
            } as const
        }

        if (decodedError.errorName === "ExecutionResult") {
            const parsedExecutionResult = executionResultSchema.parse(
                decodedError.args
            )

            return {
                result: "execution",
                data: {
                    executionResult: parsedExecutionResult
                } as const
            }
        }

        throw new Error(
            "Unexpected error whilst decoding simulateHandleOp result"
        )
    }

    async simulateHandleOpV06({
        userOperation,
        targetAddress,
        targetCallData,
        entryPoint,
        useCodeOverride = true,
        stateOverrides = undefined
    }: {
        userOperation: UserOperationV06
        targetAddress: Address
        targetCallData: Hex
        entryPoint: Address
        useCodeOverride?: boolean
        stateOverrides?: StateOverrides | undefined
    }): Promise<SimulateHandleOpResult> {
        const publicClient = this.config.publicClient
        const blockTagSupport = this.config.blockTagSupport
        const utilityWalletAddress = this.config.utilityWalletAddress
        const fixedGasLimitForEstimation =
            this.config.fixedGasLimitForEstimation

        if (this.config.codeOverrideSupport && useCodeOverride) {
            if (stateOverrides === undefined) {
                stateOverrides = {}
            }

            const senderCreatorOverride = getSenderCreatorOverride(entryPoint)

            stateOverrides[entryPoint] = {
                ...deepHexlify(stateOverrides?.[entryPoint] || {}),
                stateDiff: {
                    ...(stateOverrides[entryPoint]?.stateDiff || {}),
                    [senderCreatorOverride.slot]: senderCreatorOverride.value
                },
                code: entryPointOverride.deployedBytecode.object as Hex
            }
        }

        stateOverrides = getAuthorizationStateOverrides({
            userOperations: [userOperation],
            stateOverrides
        })

        // Remove state override if not supported by network.
        if (!this.config.balanceOverride && !this.config.codeOverrideSupport) {
            stateOverrides = undefined
        }

        try {
            await publicClient.request({
                method: "eth_call",
                params: [
                    {
                        to: entryPoint,
                        from: utilityWalletAddress,
                        data: encodeFunctionData({
                            abi: EntryPointV06Abi,
                            functionName: "simulateHandleOp",
                            args: [userOperation, targetAddress, targetCallData]
                        }),
                        ...(fixedGasLimitForEstimation !== undefined && {
                            gas: `0x${fixedGasLimitForEstimation.toString(16)}`
                        })
                    },
                    blockTagSupport
                        ? "latest"
                        : toHex(await publicClient.getBlockNumber()),
                    // @ts-ignore
                    ...(stateOverrides ? [stateOverrides] : [])
                ]
            })
        } catch (e) {
            const err = e as RpcRequestErrorType

            if (
                /return data out of bounds.*|EVM error OutOfOffset.*/.test(
                    err.details
                )
            ) {
                // out of bound (low level evm error) occurs when paymaster reverts with less than 32bytes
                return {
                    result: "failed",
                    data: "AA50 postOp revert (paymaster revert data out of bounds)"
                } as const
            }

            const cause = err.walk((err) => err instanceof RpcRequestError)

            const causeParseResult = z
                .object({
                    code: z.union([
                        z.literal(3),
                        z.literal(-32603),
                        z.literal(-32015)
                    ]),
                    message: z.string(),
                    data: z
                        .string()
                        .transform((data) => data.replace("Reverted ", ""))
                        .pipe(hexDataSchema)
                })
                .safeParse(cause?.cause)

            if (!causeParseResult.success) {
                throw new Error(JSON.stringify(cause))
            }

            const data = causeParseResult.data.data

            return this.decodeSimulateHandleOpResult(data)
        }
        throw new Error("Unexpected error")
    }
}
