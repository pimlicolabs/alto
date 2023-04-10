import { BigNumber, ContractTransaction } from "ethers"
import { UserOp } from "../userOp"

export interface GasEstimateResult {
    preverificationGas: BigNumber
    verificationGasLimit: BigNumber
    callGasLimit: BigNumber
}

export abstract class Executor {
    abstract bundle(ops: UserOp[]): ContractTransaction

    abstract estimateGas(entrypoint: string, userOp: UserOp): GasEstimateResult
}
