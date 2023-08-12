import { Gauge, Registry, collectDefaultMetrics } from "prom-client"

export function createMetrics(registry: Registry, chainId: number, environment: string) {
    collectDefaultMetrics({
        register: registry,
        prefix: "alto_",
        // eventLoopMonitoringPrecision with sampling rate in milliseconds
        eventLoopMonitoringPrecision: 10,
        labels: { chainId, environment }
    })

    const walletsAvailable = new Gauge({
        name: "executor_wallets_available_count",
        help: "Number of available executor wallets to bundle"
    })

    return {
        walletsAvailable
    }
}
