import { Gauge, Pushgateway, Registry, collectDefaultMetrics } from "prom-client"

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

    const gateway = new Pushgateway("https://pushgateway-production.up.railway.app/")
    setInterval(() => {
        gateway
            .push({ jobName: "test" })
            .then(({ resp, body }) => {
                /* ... */
            })
            .catch((err) => {
                /* ... */
            })
    }, 1000 * 10)

    return {
        walletsAvailable
    }
}
