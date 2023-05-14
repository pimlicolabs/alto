export enum ValidationErrors {
    InvalidFields = -32602,
    SimulateValidation = -32500,
    SimulatePaymasterValidation = -32501,
    OpcodeValidation = -32502,
    ExpiresShortly = -32503,
    Reputation = -32504,
    InsufficientStake = -32505,
    UnsupportedSignatureAggregator = -32506,
    InvalidSignature = -32507
}

export enum ExecutionErrors {
    UserOperationReverted = -32521
}

export class RpcError extends Error {
    code?: number
    data?: any

    // error codes from: https://eips.ethereum.org/EIPS/eip-1474
    constructor(msg: string, code?: number, data: any = undefined) {
        super(msg)

        this.code = code
        this.data = data
    }
}
