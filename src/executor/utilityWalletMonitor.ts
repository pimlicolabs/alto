import type { Logger, Metrics } from "@alto/utils"
import { formatEther, type Hex, type PublicClient } from "viem"

export class UtilityWalletMonitor {
    private publicClient: PublicClient
    private monitorInterval: number
    private utilityWalletAddress: Hex
    private timer: NodeJS.Timer | undefined
    private metrics: Metrics
    private logger: Logger

    constructor(
        publicClient: PublicClient,
        monitorInterval: number,
        utilityWalletAddress: Hex,
        metrics: Metrics,
        logger: Logger
    ) {
        this.publicClient = publicClient
        this.monitorInterval = monitorInterval
        this.utilityWalletAddress = utilityWalletAddress
        this.metrics = metrics
        this.logger = logger
    }

    private async updateMetrics() {
        try {
            const balance = await this.publicClient.getBalance({
                address: this.utilityWalletAddress
            })

            this.metrics.utilityWalletBalance.set(
                Number.parseFloat(formatEther(balance))
            )
        } catch (error) {
            this.logger.error(
                error,
                "Failed to update utility wallet balance metrics"
            )
        }
    }

    public async start() {
        if (this.timer) {
            throw new Error("UtilityWalletMonitor already started")
        }

        await this.updateMetrics()

        this.timer = setInterval(
            this.updateMetrics.bind(this),
            this.monitorInterval
        ) as NodeJS.Timer
    }

    public stop() {
        clearInterval(this.timer)
    }
}
