import { BigNumber, ContractTransaction } from "ethers"
import { UserOp } from "../userOp"
import { EntryPoint } from "../contracts"
import { Mempool } from "../mempool"

export interface GasEstimateResult {
    preverificationGas: BigNumber
    verificationGasLimit: BigNumber
    callGasLimit: BigNumber
}

export abstract class Executor {
    entryPoint: EntryPoint
    mempool: Mempool
    beneficiary: string

    constructor(entryPoint: EntryPoint, mempool: Mempool, beneficiary: string) {
        this.entryPoint = entryPoint
        this.mempool = mempool
        this.beneficiary = beneficiary
    }

    abstract bundle(_ops: UserOp[]): Promise<ContractTransaction>
}

export class BasicExecutor extends Executor {
    async bundle(ops: UserOp[]): Promise<ContractTransaction> {
        const gasLimit = this.entryPoint.estimateGas.handleOps(ops, this.beneficiary).then((gasLimit) => {
            return gasLimit.mul(12).div(10)
        })
        return this.entryPoint.handleOps(ops, this.beneficiary, { gasLimit: gasLimit })
    }
}
