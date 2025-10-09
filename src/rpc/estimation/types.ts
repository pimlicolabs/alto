import type { ExecutionResult } from "@alto/types"
import type { Hex } from "viem"

export enum BinarySearchResultType {
    Success = 0,
    OutOfGas = 1
}

export type SimulateHandleOpFailResult = {
    result: "failed"
    data: string
    code: number
}

export type SimulateHandleOpSuccessResult = {
    result: "execution"
    data: {
        callGasLimit?: bigint
        verificationGasLimit?: bigint
        paymasterVerificationGasLimit?: bigint
        executionResult: ExecutionResult
    }
}

export type SimulateHandleOpResult =
    | SimulateHandleOpFailResult
    | SimulateHandleOpSuccessResult

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
