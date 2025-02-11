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

    public getMinL1BaseFee() {
        let minL1BaseFee = this.l1BaseFeeQueue.getMinValue() || 1n
        return minL1BaseFee
    }

    public getMaxL1BaseFee() {
        let maxL1BaseFee = this.l1BaseFeeQueue.getMaxValue() || maxUint128
        return maxL1BaseFee
    }

    public getMaxL2BaseFee() {
        let maxL2BaseFee = this.l2BaseFeeQueue.getMaxValue() || maxUint128
        return maxL2BaseFee
    }
}
