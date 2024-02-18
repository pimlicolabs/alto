import {
    EntryPointAbi,
    hexDataSchema,
    EntryPointSimulationsAbi,
    PimlicoEntryPointSimulationsAbi,
    PimlicoEntryPointSimulationsBytecode
} from "@entrypoint-0.7/types"
import type {
    StateOverrides,
    UnPackedUserOperation
} from "@entrypoint-0.7/types"
import { deepHexlify, toPackedUserOperation } from "@entrypoint-0.7/utils"
import type { Chain, Hex, Transport, WalletClient } from "viem"
import {
    type Address,
    type PublicClient,
    decodeErrorResult,
    encodeFunctionData,
    toHex,
    decodeAbiParameters,
    type RpcRequestError,
    encodeDeployData
} from "viem"
import { z } from "zod"
import { ExecuteSimulatorDeployedBytecode } from "./ExecuteSimulator"

export async function simulateHandleOp(
    userOperation: UnPackedUserOperation,
    entryPoint: Address,
    publicClient: PublicClient,
    replacedEntryPoint: boolean,
    targetAddress: Address,
    targetCallData: Hex,
    stateOverride?: StateOverrides
) {
    const finalParam = replacedEntryPoint
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

    try {
        const packedUserOperation = toPackedUserOperation(userOperation)

        const entryPointSimulationsCallData = encodeFunctionData({
            abi: EntryPointSimulationsAbi,
            functionName: "simulateHandleOp",
            args: [packedUserOperation, targetAddress, targetCallData]
        })

        const calldata = encodeDeployData({
            abi: PimlicoEntryPointSimulationsAbi,
            bytecode: PimlicoEntryPointSimulationsBytecode,
            args: [entryPoint, entryPointSimulationsCallData]
        })

        await publicClient.request({
            method: "eth_call",
            params: [
                {
                    data: calldata
                },
                // @ts-ignore
                "latest",
                // @ts-ignore
                finalParam
            ]
        })
    } catch (e) {
        const rpcRequestError = e as RpcRequestError

        if (!rpcRequestError) {
            throw new Error("Unexpected error")
        }

        const causeParseResult = z
            .object({
                code: z.literal(3),
                message: z.string().regex(/execution reverted.*/),
                data: hexDataSchema
            })
            .safeParse(rpcRequestError.cause)

        if (!causeParseResult.success) {
            throw new Error(JSON.stringify(rpcRequestError.cause))
        }

        const cause = causeParseResult.data

        const decodedDelegateAndError = decodeErrorResult({
            abi: EntryPointAbi,
            data: cause.data
        })

        if (!decodedDelegateAndError?.args?.[1]) {
            throw new Error("Unexpected error")
        }

        try {
            const decodedError = decodeErrorResult({
                abi: EntryPointSimulationsAbi,
                data: decodedDelegateAndError.args[1] as Hex
            })

            if (
                decodedError &&
                decodedError.errorName === "FailedOp" &&
                decodedError.args
            ) {
                return {
                    result: "failed",
                    data: decodedError.args[1]
                } as const
            }

            if (
                decodedError &&
                decodedError.errorName === "FailedOpWithRevert" &&
                decodedError.args
            ) {
                return {
                    result: "failed",
                    data: decodedError.args[2]
                } as const
            }
        } catch {
            // no error we go the result
            const decodedResult = decodeAbiParameters(
                [
                    {
                        components: [
                            {
                                internalType: "uint256",
                                name: "preOpGas",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "paid",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "validationData",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "paymasterValidationData",
                                type: "uint256"
                            },
                            {
                                internalType: "bool",
                                name: "targetSuccess",
                                type: "bool"
                            },
                            {
                                internalType: "bytes",
                                name: "targetResult",
                                type: "bytes"
                            }
                        ],
                        internalType:
                            "struct IEntryPointSimulations.ExecutionResult",
                        name: "",
                        type: "tuple"
                    }
                ],
                decodedDelegateAndError.args[1] as Hex
            )[0]

            if (!decodedResult.targetSuccess) {
                return {
                    result: "failed",
                    data: decodedResult.targetResult
                } as const
            }

            return {
                result: "execution",
                data: decodedResult
            } as const
        }
    }

    throw new Error("Unexpected error")
}
