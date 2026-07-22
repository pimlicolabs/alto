import { encodeFunctionResult, zeroAddress } from "viem"
import { describe, expect, test } from "vitest"
import {
    type BundlerTracerResult,
    bundlerCollectorTracer
} from "../../../src/rpc/validation/BundlerCollectorTracerV07.ts"
import { decodeValidationTraceResult } from "../../../src/rpc/validation/decodeValidationTraceResult.ts"
import type { LogContext, LogDb } from "../../../src/rpc/validation/tracer.ts"
import { pimlicoSimulationsAbi } from "../../../src/types/contracts/PimlicoSimulations.ts"

describe("safe validator trace decoding", () => {
    test("collects the top-level trace output", () => {
        const tracerGlobals = globalThis as { toHex?: unknown }
        const originalToHex = tracerGlobals.toHex
        Object.assign(globalThis, {
            toHex: (value: Buffer) => `0x${value.toString("hex")}`
        })

        try {
            const tracer = bundlerCollectorTracer()
            const result = tracer.result(
                {
                    output: Buffer.from("1234", "hex"),
                    error: ""
                } as LogContext,
                {} as LogDb
            )

            expect(result.output).toBe("0x1234")
            expect(result.error).toBe("")
        } finally {
            tracerGlobals.toHex = originalToHex
        }
    })

    test("decodes the top-level result when the last internal call reverted", () => {
        const stakeInfo = {
            stake: 0n,
            unstakeDelaySec: 0n
        }
        const expectedResult = {
            returnInfo: {
                preOpGas: 100_000n,
                prefund: 200_000n,
                accountValidationData: 0n,
                paymasterValidationData: 0n,
                paymasterContext: "0x" as const
            },
            senderInfo: stakeInfo,
            factoryInfo: stakeInfo,
            paymasterInfo: stakeInfo,
            aggregatorInfo: {
                aggregator: zeroAddress,
                stakeInfo
            }
        }
        const output = encodeFunctionResult({
            abi: pimlicoSimulationsAbi,
            functionName: "simulateValidation",
            result: expectedResult
        })
        const tracerResult: BundlerTracerResult = {
            output,
            error: "",
            callsFromEntryPoint: [],
            keccak: [],
            calls: [
                {
                    type: "REVERT",
                    gasUsed: 1,
                    // EntryPoint v0.8 DelegateAndRevert(bool,bytes)
                    data: "0x99410554"
                }
            ],
            logs: [],
            debug: []
        }

        expect(decodeValidationTraceResult(tracerResult)).toEqual(
            expectedResult
        )
    })
})
