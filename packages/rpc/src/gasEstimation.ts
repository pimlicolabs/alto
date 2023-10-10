import {
    EntryPointAbi,
    RpcError,
    UserOperation,
    ValidationErrors,
    executionResultSchema,
    hexDataSchema
} from "@alto/types"
import { Logger, Metrics } from "@alto/utils"
import { Address, PublicClient, encodeFunctionData, toHex } from "viem"
import { zeroAddress, decodeErrorResult } from "viem"
import type { Chain, RpcRequestErrorType, Transport } from "viem"
import * as chains from "viem/chains"
import { z } from "zod"

async function simulateHandleOp(userOperation: UserOperation, entryPoint: Address, publicClient: PublicClient) {
    try {
        await publicClient.request({
            method: "eth_call",
            params: [
                // @ts-ignore
                {
                    to: entryPoint,
                    data: encodeFunctionData({
                        abi: EntryPointAbi,
                        functionName: "simulateHandleOp",
                        args: [userOperation, zeroAddress, "0x"]
                    }),
                    gas: toHex(100_000_000)
                },
                // @ts-ignore
                "latest",
                // @ts-ignore
                {
                    [userOperation.sender]: {
                        balance: toHex(100000_000000000000000000n)
                    }
                }
            ]
        })
    } catch (e) {
        const err = e as RpcRequestErrorType

        const causeParseResult = z
            .object({
                code: z.literal(3),
                message: z.string().regex(/execution reverted.*/),
                data: hexDataSchema
            })
            .safeParse(err.cause)

        if (!causeParseResult.success) {
            throw new Error(JSON.stringify(err.cause))
        }

        const cause = causeParseResult.data

        const decodedError = decodeErrorResult({ abi: EntryPointAbi, data: cause.data })

        if (decodedError.errorName === "FailedOp") {
            return { result: "failed", data: decodedError.args[1] } as const
        } else if (decodedError.errorName === "ExecutionResult") {
            const parsedExecutionResult = executionResultSchema.parse(decodedError.args)
            return { result: "execution", data: parsedExecutionResult } as const
        } else {
            throw new Error("Unexpected error")
        }
    }

    throw new Error("Unexpected error")
}

function tooLow(error: string) {
    return (
        error === "AA40 over verificationGasLimit" ||
        error === "AA41 too little verificationGas" ||
        error === "AA51 prefund below actualGasCost" ||
        error === "AA13 initCode failed or OOG" ||
        error === "AA21 didn't pay prefund" ||
        error === "AA23 reverted (or OOG)" ||
        error === "AA33 reverted (or OOG)" ||
        error === "return data out of bounds" ||
        error === "validation OOG"
    )
}

export async function estimateVerificationGasLimit(
    userOperation: UserOperation,
    entryPoint: Address,
    publicClient: PublicClient,
    logger: Logger,
    metrics: Metrics
): Promise<bigint> {
    userOperation.callGasLimit = 0n

    let lower = 0n
    let upper = 10_000_000n
    let final: bigint | null = null

    const cutoff = 20_000n

    userOperation.verificationGasLimit = upper
    userOperation.callGasLimit = 0n

    let simulationCounter = 1
    const initial = await simulateHandleOp(userOperation, entryPoint, publicClient)

    if (initial.result === "execution") {
        upper = 6n * (initial.data.preOpGas - userOperation.preVerificationGas)
    } else {
        throw new RpcError(
            `UserOperation reverted during simulation with reason: ${initial.data}`,
            ValidationErrors.SimulateValidation
        )
    }

    // binary search
    while (upper - lower > cutoff) {
        const mid = (upper + lower) / 2n

        userOperation.verificationGasLimit = mid
        userOperation.callGasLimit = 0n

        const error = await simulateHandleOp(userOperation, entryPoint, publicClient)
        simulationCounter++

        if (error.result === "execution") {
            upper = mid
            final = mid
            logger.debug(`Verification gas limit: ${mid}`)
        } else if (tooLow(error.data)) {
            logger.debug(`Verification gas limit: ${mid}, error: ${error.data}`)
            lower = mid
        } else {
            logger.debug(`Verification gas limit: ${mid}, error: ${error.data}`)
            throw new Error("Unexpected error")
        }
    }

    if (final === null) {
        throw new RpcError("Failed to estimate verification gas limit")
    }

    logger.info(`Verification gas limit: ${final}`)

    metrics.verificationGasLimitEstimationCount.observe(simulationCounter)

    return final
}

export async function estimateCallGasLimit(
    userOperation: UserOperation,
    entryPoint: Address,
    publicClient: PublicClient<Transport, Chain>,
    logger: Logger,
    metrics: Metrics
): Promise<bigint> {
    const error = await simulateHandleOp(userOperation, entryPoint, publicClient)

    if (error.result === "failed") {
        throw new RpcError(
            `UserOperation reverted during simulation with reason: ${error.data}`,
            ValidationErrors.SimulateValidation
        )
    }

    logger.info(`Call gas limit estimate: ${error.data.paid / userOperation.maxFeePerGas - error.data.preOpGas}`)

    const executionResult = error.data

    const calculatedCallGasLimit =
        executionResult.paid / userOperation.maxFeePerGas - executionResult.preOpGas + 21000n + 50000n

    let callGasLimit = calculatedCallGasLimit > 9000n ? calculatedCallGasLimit : 9000n

    const chainId = publicClient.chain.id

    if (
        chainId === chains.optimism.id ||
        chainId === chains.optimismGoerli.id ||
        chainId === chains.base.id ||
        chainId === chains.baseGoerli.id ||
        chainId === chains.opBNB.id ||
        chainId === chains.opBNBTestnet.id
    ) {
        callGasLimit = callGasLimit + 150000n
    }

    return callGasLimit
}
