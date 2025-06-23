import type { Hex } from "viem"
import type { ExecutionResult } from "@alto/types"

export type SimulateHandleOpResult =
    | {
          result: "failed"
          data: string
          code: number
      }
    | {
          result: "execution"
          data: {
              callGasLimit?: bigint
              verificationGasLimit?: bigint
              paymasterVerificationGasLimit?: bigint
              executionResult: ExecutionResult
          }
      }

export type SimulateBinarySearchResult =
    | {
          result: "success"
          data: {
              resultType: 0 // Success enum value
              successData: {
                  gasUsed: bigint
                  success: boolean
                  returnData: Hex
              }
              outOfGasData: {
                  optimalGas: bigint
                  minGas: bigint
                  maxGas: bigint
              }
          }
      }
    | {
          result: "failed"
          data: string
          code: number
      }
