export enum ValidationErrors {
    InvalidRequest = -32601,
    InvalidFields = -32602,
    SimulateValidation = -32500,
    SimulatePaymasterValidation = -32501,
    OpcodeValidation = -32502,
    ExpiresShortly = -32503,
    Reputation = -32504,
    InsufficientStake = -32505,
    UnsupportedSignatureAggregator = -32506,
    InvalidSignature = -32507,
    PaymasterDepositTooLow = -32508
}

export enum ExecutionErrors {
    UserOperationReverted = -32521
}

export class RpcError extends Error {
    code?: number
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    data?: any

    // error codes from: https://eips.ethereum.org/EIPS/eip-1474
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    constructor(msg: string, code?: number, data: any = undefined) {
        super(msg)

        this.code = code
        this.data = data
    }
}

export type Environment = "production" | "staging" | "development"
export type ApiVersion = "v1" | "v2"
export type ChainType =
    | "default"
    | "op-stack"
    | "arbitrum"
    | "hedera"
    | "mantle"
