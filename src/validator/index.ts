import { BigNumberish, ethers } from "ethers"
import { EntryPoint } from "../contracts"
import { Mempool } from "../mempool"
import { UserOp } from "../userOp"

interface ValidationResult {
    valid: boolean
    code?: number
    message?: string
}

interface GasEstimateResult {
    preverificationGas: BigNumberish
    verificationGasLimit: BigNumberish
    callGasLimit: BigNumberish
}

// 1 validator per entrypoint, per network
export abstract class Validator {
    entryPoint: EntryPoint
    mempool: Mempool
    constructor(entryPoint: EntryPoint, mempool: Mempool) {
        this.entryPoint = entryPoint
        this.mempool = mempool
    }
    public abstract validate(userOp: UserOp): Promise<ValidationResult>
    public abstract estimateGas(userOp: UserOp): Promise<GasEstimateResult>
}

export class EmptyValidator extends Validator {
    async validate(userOp: UserOp): Promise<ValidationResult> {
        await this.mempool.add(this.entryPoint.address, userOp)
        return { valid: true }
    }

    async estimateGas(userOp: UserOp): Promise<GasEstimateResult> {
        const provider = this.entryPoint.provider
        const callGasLimit = await provider.estimateGas({
            from: this.entryPoint.address,
            to: userOp.sender,
            data: userOp.callData,
        })
        return {
            preverificationGas: 100000,
            verificationGasLimit: 100000,
            callGasLimit: callGasLimit.mul(11).div(10),
        }
    }
}
