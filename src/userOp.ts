import { BigNumber } from "ethers"

export interface UserOp {
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

export interface UserOpRequest {
    userOp: UserOp
    entrypoint: string
}
