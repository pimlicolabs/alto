import { decodeFunctionResult } from "viem"
import { pimlicoSimulationsAbi } from "../../types/contracts/PimlicoSimulations"
import { ERC7769Errors, RpcError } from "../../types/utils"
import type { ValidationResult07 } from "../../types/validation"
import type { BundlerTracerResult } from "./BundlerCollectorTracerV07"

export function decodeValidationTraceResult(
    tracerResult: Pick<BundlerTracerResult, "output" | "error">
): ValidationResult07 {
    if (tracerResult.error) {
        throw new RpcError(tracerResult.error, ERC7769Errors.SimulateValidation)
    }

    try {
        return decodeFunctionResult({
            abi: pimlicoSimulationsAbi,
            functionName: "simulateValidation",
            data: tracerResult.output
        }) as ValidationResult07
    } catch {
        throw new RpcError(
            "Invalid response. Could not decode simulateValidation result",
            ERC7769Errors.SimulateValidation
        )
    }
}
