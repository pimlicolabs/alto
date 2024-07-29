import type { Logger, Metrics } from "@alto/utils"
import { formatEther, type Hex, type PublicClient } from "viem"

export class ExecutorWalletsMonitor {
    private publicClient: PublicClient
    private monitorInterval: number
    private executorWallets: Hex[]
    private timer: NodeJS.Timer | undefined
    private metrics: Metrics
    private logger: Logger

    constructor(
        publicClient: PublicClient,
        monitorInterval: number,
        executorWallets: Hex[],
        metrics: Metrics,
        logger: Logger
    ) {
        this.publicClient = publicClient
        this.monitorInterval = monitorInterval
        this.executorWallets = executorWallets
        this.metrics = metrics
        this.logger = logger
    }

    private async updateMetrics() {
        console.log(this.executorWallets);
        try {
            await Promise.all(this.executorWallets.map(async (wallet) => {
                const balance = await this.publicClient.getBalance({
                    address: wallet
                })
    
                this.metrics.executorWalletsBalances.set(
                    {
                        wallet
                    },
                    Number.parseFloat(formatEther(balance))
                )    
            }))
        } catch (error) {
            this.logger.error(
                error,
                "Failed to update executor wallets balance metrics"
            )
        }
    }

    public async start() {
        if (this.timer) {
            throw new Error("ExecutorWalletsMonitor already started")
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
