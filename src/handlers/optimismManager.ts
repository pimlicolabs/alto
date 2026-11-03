import type { Logger } from "@alto/utils"
import type { AltoConfig } from "../createConfig"
import { type MinMaxQueue, createMinMaxQueue } from "../utils/minMaxQueue"

export class OptimismManager {
    private readonly logger: Logger
    private readonly l1FeeQueue: MinMaxQueue

    constructor({ config }: { config: AltoConfig }) {
        this.logger = config.getLogger(
            { module: "optimism_manager" },
            { level: config.logLevel }
        )
        this.l1FeeQueue = createMinMaxQueue({
            queueName: "l1-fee-queue",
            config
        })
    }

    public async getMinL1Fee() {
        return (await this.l1FeeQueue.getMinValue()) || 1n
    }

    public saveL1FeeValue(l1Fee: bigint) {
        this.l1FeeQueue.saveValue(l1Fee).catch((err) => {
            this.logger.error({ err }, "Failed to save L1 fee")
        })
    }
}
