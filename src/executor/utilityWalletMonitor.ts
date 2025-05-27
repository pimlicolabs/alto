import type { Logger, Metrics } from "@alto/utils"
import type { Address } from "abitype"
import { type Hex, formatEther } from "viem"
import type { AltoConfig } from "../createConfig"

export class UtilityWalletMonitor {
    private config: AltoConfig
    private utilityWalletAddress: Hex
    private timer: NodeJS.Timer | undefined
    private metrics: Metrics
    private logger: Logger

    constructor({
        config,
        metrics,
        utilityWalletAddress
    }: {
        config: AltoConfig
        metrics: Metrics
        utilityWalletAddress: Address
    }) {
        this.config = config
        this.utilityWalletAddress = utilityWalletAddress
        this.metrics = metrics
        this.logger = config.getLogger(
            { module: "utility_wallet_monitor" },
            {
                level: config.logLevel
            }
        )
    }

    private async updateMetrics() {
        try {
            const balance = await this.config.publicClient.getBalance({
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
            this.config.utilityWalletMonitorInterval
        ) as NodeJS.Timer
    }

    public stop() {
        clearInterval(this.timer)
    }
}
