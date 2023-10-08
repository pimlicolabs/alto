import {
    EntryPointAbi,
    RpcError,
    UserOperation,
    ValidationErrors,
    executionResultSchema,
    hexDataSchema
} from "@alto/types"
import { Logger } from "@alto/utils"
import { Address, PublicClient, encodeFunctionData, toHex } from "viem"
import { zeroAddress, decodeErrorResult } from "viem"
import type { RpcRequestErrorType } from "viem"
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
                message: z.literal("execution reverted"),
                data: hexDataSchema
            })
            .safeParse(err.cause)

        if (!causeParseResult.success) {
            throw err
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
    logger: Logger
): Promise<bigint> {
    userOperation.callGasLimit = 0n

    let lower = 0n
    let upper = 10_000_000n
    let final: bigint | null = null

    const cutoff = 20_000n

    userOperation.verificationGasLimit = upper
    userOperation.callGasLimit = 0n

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

    return final
}

/*
async function estimateCallGasLimit(
    userOperation: UserOperation,
    entryPoint: Address,
    publicClient: PublicClient,
    logger: Logger
): Promise<bigint> {
    userOperation.verificationGasLimit = 0n
    userOperation.callGasLimit = 0n

    let lower = 0n
    let upper = 10_000_000n
    let final: bigint | null = null

    const cutoff = 20_000n

    // binary search
    while (upper - lower > cutoff) {
        const mid = (upper + lower) / 2n

        userOperation.callGasLimit = mid

        const error = await simulateHandleOp(userOperation, entryPoint, publicClient)

        logger.debug(`Call gas limit: ${mid}, error: ${error}`)

        if (error === null) {
            upper = mid
            final = mid
        } else if (tooLow(error)) {
            lower = mid
        } else {
            throw new Error("Unexpected error")
        }
    }

    if (final === null) {
        throw new RpcError("Failed to estimate call gas limit")
    }

    logger.info(`Call gas limit: ${final}`)

    return final
}
*/
