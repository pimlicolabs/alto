import {
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
    type PublicClient,
    decodeErrorResult,
    encodeFunctionData,
    toHex
} from "viem"
import { z } from "zod"
import type { SimulateHandleOpResult } from "./types"

export class GasEstimatorV06 {
    publicClient: PublicClient
    blockTagSupport: boolean
    utilityWalletAddress: Address
    fixedGasLimitForEstimation?: bigint

    constructor(
        publicClient: PublicClient,
        blockTagSupport: boolean,
        utilityWalletAddress: Address,
        fixedGasLimitForEstimation?: bigint
    ) {
        this.publicClient = publicClient
        this.blockTagSupport = blockTagSupport
        this.utilityWalletAddress = utilityWalletAddress
        this.fixedGasLimitForEstimation = fixedGasLimitForEstimation
    }

    async simulateHandleOpV06({
        userOperation,
        targetAddress,
        targetCallData,
        entryPoint,
        stateOverrides = undefined
    }: {
        userOperation: UserOperationV06
        targetAddress: Address
        targetCallData: Hex
        entryPoint: Address
        stateOverrides?: StateOverrides | undefined
    }): Promise<SimulateHandleOpResult> {
        const {
            publicClient,
            blockTagSupport,
            utilityWalletAddress,
            fixedGasLimitForEstimation
        } = this

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

            const cause = causeParseResult.data

            if (cause.data === "0x") {
                throw new RpcError(
                    "AA23 reverted: UserOperation called non-existant contract, or reverted with 0x",
                    ValidationErrors.SimulateValidation
                )
            }

            const decodedError = decodeErrorResult({
                abi: [...EntryPointV06Abi, ...EntryPointV06SimulationsAbi],
                data: cause.data
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
        }
        throw new Error("Unexpected error")
    }
}
