export interface UserOp {
    sender: string;
    nonce: string;
    initCode: string;
    callData: string;
    callGasLimit: string;
    verificationGasLimit : string;
    preVerificationGas : string;
    maxFeePerGas : string;
    maxPriorityFeePerGas : string;
    paymasterAndData : string;
    signature : string;
}

export interface UserOpRequest {
    userOp : UserOp;
    entrypoint : string;
}