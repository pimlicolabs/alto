import type { AltoConfig } from "../createConfig"
import { type MinMaxQueue, createMinMaxQueue } from "../utils/minMaxQueue"

export class CitreaManager {
    private readonly l1FeeRateQueue: MinMaxQueue

    constructor({ config }: { config: AltoConfig }) {
        this.l1FeeRateQueue = createMinMaxQueue({
            queueName: "citrea-l1-fee-rate-queue",
            config
        })
    }

    public async getMinL1FeeRate() {
        return (await this.l1FeeRateQueue.getMinValue()) || 1n
    }

    public saveL1FeeRate(l1FeeRate: bigint) {
        this.l1FeeRateQueue.saveValue(l1FeeRate)
    }
}
