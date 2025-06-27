import type { Hex } from "viem"
import type { ExecutionResult } from "@alto/types"

export enum BinarySearchResultType {
    Success = 0,
    OutOfGas = 1
}

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
              gasUsed: bigint
              success: boolean
              returnData: Hex
          }
      }
    | {
          result: "failed"
          data: string
          code: number
      }
