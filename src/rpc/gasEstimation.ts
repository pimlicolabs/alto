import {
    EntryPointV06Abi,
    type ExecutionResult,
    RpcError,
    type UserOperation,
    ValidationErrors,
    executionResultSchema,
    hexDataSchema,
    EntryPointV06SimulationsAbi
} from "@alto/types"
import type {
    StateOverrides,
    TargetCallResult,
    UserOperationV06,
    UserOperationV07
} from "@alto/types"
import { deepHexlify, isVersion06 } from "@alto/utils"
import type { Hex, RpcRequestErrorType } from "viem"
import {
    type Address,
    type PublicClient,
    decodeErrorResult,
    encodeFunctionData,
    toHex
} from "viem"
import { z } from "zod"
import { ExecuteSimulatorDeployedBytecode } from "./ExecuteSimulator"
import { simulateHandleOpV07 } from "./EntryPointSimulationsV07"

function getStateOverrides({
    userOperation,
    entryPoint,
    replacedEntryPoint,
    stateOverride = {}
}: {
    entryPoint: Address
    replacedEntryPoint: boolean
    stateOverride: StateOverrides
    userOperation: UserOperation
}) {
    return replacedEntryPoint
        ? {
              ...stateOverride,
              [userOperation.sender]: {
                  balance: toHex(100000_000000000000000000n),
                  ...(stateOverride
                      ? deepHexlify(stateOverride?.[userOperation.sender])
                      : [])
              },
              [entryPoint]: {
                  code: ExecuteSimulatorDeployedBytecode
              }
          }
        : {
              ...stateOverride,
              [userOperation.sender]: {
                  balance: toHex(100000_000000000000000000n),
                  ...(stateOverride
                      ? deepHexlify(stateOverride?.[userOperation.sender])
                      : [])
              }
          }
}

export async function simulateHandleOpV06(
    userOperation: UserOperationV06,
    entryPoint: Address,
    publicClient: PublicClient,
    targetAddress: Address,
    targetCallData: Hex,
    blockTagSupport: boolean,
    utilityWalletAddress: Address,
    finalParam: StateOverrides | undefined = undefined,
    fixedGasLimitForEstimation?: bigint
): Promise<SimulateHandleOpResult> {
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
                ...(finalParam ? [finalParam] : [])
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
                        .regex(/VM Exception while processing transaction:.*/),
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

export type SimulateHandleOpResult<
    TypeResult extends "failed" | "execution" = "failed" | "execution"
> = {
    result: TypeResult
    data: TypeResult extends "failed"
        ? string
        : {
              callDataResult?: TargetCallResult
              executionResult: ExecutionResult
          }
    code?: TypeResult extends "failed" ? number : undefined
}

export function simulateHandleOp(
    userOperation: UserOperation,
    queuedUserOperations: UserOperation[],
    entryPoint: Address,
    publicClient: PublicClient,
    replacedEntryPoint: boolean,
    targetAddress: Address,
    targetCallData: Hex,
    balanceOverrideEnabled: boolean,
    chainId: number,
    blockTagSupport: boolean,
    utilityWalletAddress: Address,
    stateOverride: StateOverrides = {},
    entryPointSimulationsAddress?: Address,
    fixedGasLimitForEstimation?: bigint
): Promise<SimulateHandleOpResult> {
    let finalStateOverride = undefined

    if (balanceOverrideEnabled) {
        finalStateOverride = getStateOverrides({
            userOperation,
            entryPoint,
            replacedEntryPoint,
            stateOverride
        })
    }

    if (isVersion06(userOperation)) {
        return simulateHandleOpV06(
            userOperation,
            entryPoint,
            publicClient,
            targetAddress,
            targetCallData,
            blockTagSupport,
            utilityWalletAddress,
            finalStateOverride,
            fixedGasLimitForEstimation
        )
    }

    if (!entryPointSimulationsAddress) {
        throw new RpcError(
            "entryPointSimulationsAddress must be provided for V07 UserOperation",
            ValidationErrors.InvalidFields
        )
    }

    return simulateHandleOpV07(
        userOperation,
        queuedUserOperations as UserOperationV07[],
        entryPoint,
        publicClient,
        entryPointSimulationsAddress,
        chainId,
        blockTagSupport,
        utilityWalletAddress,
        finalStateOverride,
        fixedGasLimitForEstimation
    )
}
