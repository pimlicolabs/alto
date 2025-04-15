import { maxUint128 } from "viem"
import { MinMaxQueue, createMinMaxQueue } from "../utils/minMaxQueue"
import { AltoConfig } from "../createConfig"

export class ArbitrumManager {
    private l1BaseFeeQueue: MinMaxQueue
    private l2BaseFeeQueue: MinMaxQueue

    constructor({ config }: { config: AltoConfig }) {
        this.l1BaseFeeQueue = createMinMaxQueue({
            keyPrefix: "l1-base-fee-queue",
            config
        })
        this.l2BaseFeeQueue = createMinMaxQueue({
            keyPrefix: "l2-base-fee-queue",
            config
        })
    }

    public saveL1BaseFee(baseFee: bigint) {
        this.l1BaseFeeQueue.saveValue(baseFee)
    }

    public saveL2BaseFee(baseFee: bigint) {
        this.l2BaseFeeQueue.saveValue(baseFee)
    }

    public async getMinL1BaseFee() {
        let minL1BaseFee = await this.l1BaseFeeQueue.getMinValue()
        return minL1BaseFee || 1n
    }

    public async getMaxL1BaseFee() {
        let maxL1BaseFee = await this.l1BaseFeeQueue.getMaxValue()
        return maxL1BaseFee || maxUint128
    }

    public async getMaxL2BaseFee() {
        let maxL2BaseFee = await this.l2BaseFeeQueue.getMaxValue()
        return maxL2BaseFee || maxUint128
    }
}
