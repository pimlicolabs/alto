import { maxUint128 } from "viem"
import type { AltoConfig } from "../createConfig"
import { type MinMaxQueue, createMinMaxQueue } from "../utils/minMaxQueue"

export class ArbitrumManager {
    private readonly l1BaseFeeQueue: MinMaxQueue
    private readonly l2BaseFeeQueue: MinMaxQueue

    constructor({ config }: { config: AltoConfig }) {
        this.l1BaseFeeQueue = createMinMaxQueue({
            queueName: "l1-base-fee-queue",
            config
        })
        this.l2BaseFeeQueue = createMinMaxQueue({
            queueName: "l2-base-fee-queue",
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
        const minL1BaseFee = await this.l1BaseFeeQueue.getMinValue()
        return minL1BaseFee || 1n
    }

    public async getMaxL1BaseFee() {
        const maxL1BaseFee = await this.l1BaseFeeQueue.getMaxValue()
        return maxL1BaseFee || maxUint128
    }

    public async getMinL2BaseFee() {
        const minL2BaseFee = await this.l2BaseFeeQueue.getMinValue()
        return minL2BaseFee || 1n
    }

    public async getMaxL2BaseFee() {
        const maxL2BaseFee = await this.l2BaseFeeQueue.getMaxValue()
        return maxL2BaseFee || maxUint128
    }
}
