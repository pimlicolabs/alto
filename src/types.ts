import { BigNumber } from "ethers"

export interface UserOperation {
    sender: string
    nonce: BigNumber
    initCode: string
    callData: string
    callGasLimit: BigNumber
    verificationGasLimit: BigNumber
    preVerificationGas: BigNumber
    maxFeePerGas: BigNumber
    maxPriorityFeePerGas: BigNumber
    paymasterAndData: string
    signature: string
}

export interface UserOperationRequest {
    userOperation: UserOperation
    entryPoint: string
}
