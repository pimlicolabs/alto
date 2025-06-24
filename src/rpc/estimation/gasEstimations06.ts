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
    RpcRequestError
} from "viem"
import { z } from "zod"
import type { SimulateHandleOpResult } from "./types"
import type { AltoConfig } from "../../createConfig"
import { parseFailedOpWithRevert } from "./gasEstimations07"
import {
    deepHexlify,
    getAuthorizationStateOverrides,
    type Logger
} from "@alto/utils"
import entryPointOverride from "../../contracts/EntryPointGasEstimationOverride.sol/EntryPointGasEstimationOverride06.json" with {
    type: "json"
}
import { getSenderCreatorOverride } from "../../utils/entryPointOverrides"

export class GasEstimatorV06 {
    private config: AltoConfig
    private logger: Logger

    constructor(config: AltoConfig) {
        this.config = config
        this.logger = config.getLogger(
            {
                module: "gas-estimator-v06"
            },
            {
                level: config.logLevel
            }
        )
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
                data: decodedError.args[1] as string,
                code: ValidationErrors.SimulateValidation
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
                data: decodedError.args[0],
                code: ValidationErrors.SimulateValidation
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
                )}`,
                code: ValidationErrors.SimulateValidation
            } as const
        }

        if (
            decodedError &&
            decodedError.errorName === "Error" &&
            decodedError.args
        ) {
            return {
                result: "failed",
                data: decodedError.args[0],
                code: ValidationErrors.SimulateValidation
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
        userStateOverrides = undefined
    }: {
        userOperation: UserOperationV06
        targetAddress: Address
        targetCallData: Hex
        entryPoint: Address
        useCodeOverride?: boolean
        userStateOverrides?: StateOverrides | undefined
    }): Promise<SimulateHandleOpResult> {
        const {
            publicClient,
            //blockTagSupport,
            utilityWalletAddress,
            fixedGasLimitForEstimation,
            balanceOverride,
            codeOverrideSupport
        } = this.config

        if (codeOverrideSupport && useCodeOverride) {
            if (userStateOverrides === undefined) {
                userStateOverrides = {}
            }

            const senderCreatorOverride = getSenderCreatorOverride(entryPoint)

            userStateOverrides[entryPoint] = {
                ...deepHexlify(userStateOverrides?.[entryPoint] || {}),
                stateDiff: {
                    ...(userStateOverrides[entryPoint]?.stateDiff || {}),
                    [senderCreatorOverride.slot]: senderCreatorOverride.value
                },
                code: entryPointOverride.deployedBytecode.object as Hex
            }
        }

        let stateOverride: StateOverrides | undefined =
            getAuthorizationStateOverrides({
                userOperations: [userOperation],
                stateOverrides: userStateOverrides
            })

        // Remove state override if not supported by network.
        if (!balanceOverride && !codeOverrideSupport) {
            stateOverride = undefined
        }

        try {
            await publicClient.call({
                account: utilityWalletAddress,
                to: entryPoint,
                data: encodeFunctionData({
                    abi: EntryPointV06Abi,
                    functionName: "simulateHandleOp",
                    args: [userOperation, targetAddress, targetCallData]
                }),
                gas: fixedGasLimitForEstimation,
                stateOverride
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
                    data: "AA50 postOp revert (paymaster revert data out of bounds)",
                    code: ValidationErrors.SimulateValidation
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
                this.logger.warn(
                    { err: cause },
                    "Failed to parse RPC error in simulateHandleOp"
                )
                throw new Error(JSON.stringify(cause))
            }

            const data = causeParseResult.data.data

            return this.decodeSimulateHandleOpResult(data)
        }
        throw new Error("Unexpected error")
    }
}
