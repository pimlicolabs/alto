import { UserOperation, HexData32, Address } from "@alto/types"
import { Mempool } from "@alto/mempool"
import { PublicClient } from "viem"
export interface IValidator {
    validateUserOp(userOp: UserOperation): Promise<HexData32>
}

export class EmptyValidator implements IValidator {
    constructor(readonly publicClient: PublicClient, readonly entrypoint: Address, readonly memPool: Mempool) {}
    async validateUserOp(userOp: UserOperation): Promise<HexData32> {
        return await this.memPool.add(this.entrypoint, userOp)
    }
}
