import {
    ENTRYPOINT_V06_SIMULATION_OVERRIDE,
    EntryPointV06Abi,
    EntryPointV06SimulationsAbi,
    RpcError,
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
    toHex
} from "viem"
import { z } from "zod"
import type { SimulateHandleOpResult } from "./types"
import type { AltoConfig } from "../../createConfig"
import { deepHexlify } from "../../utils/userop"

export class GasEstimatorV06 {
    private config: AltoConfig

    constructor(config: AltoConfig) {
        this.config = config
    }

    decodeSimulateHandleOpResult(data: Hex): SimulateHandleOpResult {
        if (data === "0x") {
            throw new RpcError(
                "AA23 reverted: UserOperation called non-existant contract, or reverted with 0x",
                ValidationErrors.SimulateValidation
            )
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
        const utilityWalletAddress =
            this.config.utilityPrivateKey?.address ??
            "0x4337000c2828F5260d8921fD25829F606b9E8680"
        const fixedGasLimitForEstimation =
            this.config.fixedGasLimitForEstimation

        if (this.config.codeOverrideSupport && useCodeOverride) {
            if (stateOverrides === undefined) {
                stateOverrides = {}
            }

            stateOverrides[entryPoint] = {
                ...deepHexlify(stateOverrides?.[entryPoint] || {}),
                code: ENTRYPOINT_V06_SIMULATION_OVERRIDE
            }
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

            const causeParseResult = z
                .union([
                    z.object({
                        code: z.literal(3),
                        message: z.string(),
                        data: hexDataSchema
                    }),
                    /* Fuse RPCs return in this format. */
                    z.object({
                        code: z.number(),
                        message: z.string().regex(/VM execution error.*/),
                        data: z
                            .string()
                            .transform((data) => data.replace("Reverted ", ""))
                            .pipe(hexDataSchema)
                    }),
                    z.object({
                        code: z.number(),
                        message: z
                            .string()
                            .regex(
                                /VM Exception while processing transaction:.*/
                            ),
                        data: hexDataSchema
                    })
                ])
                .safeParse(err.cause)

            if (!causeParseResult.success) {
                throw new Error(JSON.stringify(err.cause))
            }

            const data = causeParseResult.data.data

            return this.decodeSimulateHandleOpResult(data)
        }
        throw new Error("Unexpected error")
    }
}
