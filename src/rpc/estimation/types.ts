import type {
    Address,
    BinarySearchCallResult,
    ExecutionResult,
    PackedUserOperation
} from "@alto/types"
import type { Hex } from "viem"

export type SimulateHandleOpResult<
    TypeResult extends "failed" | "execution" = "failed" | "execution"
> = {
    result: TypeResult
    data: TypeResult extends "failed"
        ? string
        : {
              callGasLimit?: bigint
              verificationGasLimit?: bigint
              paymasterVerificationGasLimit?: bigint
              executionResult: ExecutionResult
          }
    code?: TypeResult extends "failed" ? number : undefined
}

export type SimulateBinarySearchRetryResult<
    TypeResult extends "failed" | "success" = "failed" | "success"
> = {
    result: TypeResult
    data: TypeResult extends "failed" ? string : BinarySearchCallResult
    code?: TypeResult extends "failed" ? number : undefined
}

// Struct used when calling v0.7 EntryPointSimulations.simulateCallData.
export type CallDataSimulationArgs = {
    // UserOperation to simulate.
    op: PackedUserOperation
    // UserOperation sender.
    target: Address
    // Encoded userOperation calldata to simulate.
    targetCallData: Hex
}

// Result of EntryPointSimulations.simulateCallData when simulation ends early due to hitting eth_call gasLimit.
export type SimulationOutOfGasResult = {
    optimalGas: bigint
    minGas: bigint
    maxGas: bigint
}

export const simulationValidationResultStruct = [
    {
        components: [
            {
                components: [
                    {
                        internalType: "uint256",
                        name: "preOpGas",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "prefund",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "accountValidationData",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "paymasterValidationData",
                        type: "uint256"
                    },
                    {
                        internalType: "bytes",
                        name: "paymasterContext",
                        type: "bytes"
                    }
                ],
                internalType: "struct IEntryPoint.ReturnInfo",
                name: "returnInfo",
                type: "tuple"
            },
            {
                components: [
                    {
                        internalType: "uint256",
                        name: "stake",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "unstakeDelaySec",
                        type: "uint256"
                    }
                ],
                internalType: "struct IStakeManager.StakeInfo",
                name: "senderInfo",
                type: "tuple"
            },
            {
                components: [
                    {
                        internalType: "uint256",
                        name: "stake",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "unstakeDelaySec",
                        type: "uint256"
                    }
                ],
                internalType: "struct IStakeManager.StakeInfo",
                name: "factoryInfo",
                type: "tuple"
            },
            {
                components: [
                    {
                        internalType: "uint256",
                        name: "stake",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "unstakeDelaySec",
                        type: "uint256"
                    }
                ],
                internalType: "struct IStakeManager.StakeInfo",
                name: "paymasterInfo",
                type: "tuple"
            },
            {
                components: [
                    {
                        internalType: "address",
                        name: "aggregator",
                        type: "address"
                    },
                    {
                        components: [
                            {
                                internalType: "uint256",
                                name: "stake",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "unstakeDelaySec",
                                type: "uint256"
                            }
                        ],
                        internalType: "struct IStakeManager.StakeInfo",
                        name: "stakeInfo",
                        type: "tuple"
                    }
                ],
                internalType: "struct IEntryPoint.AggregatorStakeInfo",
                name: "aggregatorInfo",
                type: "tuple"
            }
        ],
        internalType: "struct IEntryPointSimulations.ValidationResult",
        name: "",
        type: "tuple"
    }
] as const
