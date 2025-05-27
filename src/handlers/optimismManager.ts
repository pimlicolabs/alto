import type { AltoConfig } from "../createConfig"
import { type MinMaxQueue, createMinMaxQueue } from "../utils/minMaxQueue"

export class OptimismManager {
    private l1FeeQueue: MinMaxQueue

    constructor({ config }: { config: AltoConfig }) {
        this.l1FeeQueue = createMinMaxQueue({
            keyPrefix: "l1-fee-queue",
            config
        })
    }

    public async getMinL1Fee() {
        return (await this.l1FeeQueue.getMinValue()) || 1n
    }

    public saveL1FeeValue(l1Fee: bigint) {
        this.l1FeeQueue.saveValue(l1Fee)
    }
}
