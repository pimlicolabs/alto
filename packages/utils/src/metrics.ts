import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client"

export type Metrics = ReturnType<typeof createMetrics>

export function createMetrics(registry: Registry, chainId: number, environment: string) {
    collectDefaultMetrics({
        register: registry,
        prefix: "alto_",
        // eventLoopMonitoringPrecision with sampling rate in milliseconds
        eventLoopMonitoringPrecision: 10,
        labels: { chainId, environment }
    })

    const walletsAvailable = new Gauge({
        name: "alto_executor_wallets_available_count",
        help: "Number of available executor wallets used to bundle",
        labelNames: ["chainId"] as const
    })

    const walletsTotal = new Gauge({
        name: "alto_executor_wallets_total_count",
        help: "Number of total executor wallets used to bundle",
        labelNames: ["chainId"] as const
    })

    const userOperationsBundlesIncluded = new Counter({
        name: "alto_user_operations_bundles_included_count",
        help: "Number of user operations bundles included on-chain",
        labelNames: ["chainId"] as const
    })

    const userOperationsBundlesSubmitted = new Counter({
        name: "alto_user_operations_bundles_submitted_count",
        help: "Number of user operations bundles submitted on-chain",
        labelNames: ["chainId"] as const
    })

    const userOperationsReceived = new Counter({
        name: "alto_user_operations_received_count",
        help: "Number of user operations received",
        labelNames: ["chainId"] as const
    })

    const userOperationsValidationSuccess = new Counter({
        name: "alto_user_operations_validation_success_count",
        help: "Number of user operations successfully validated",
        labelNames: ["chainId"] as const
    })

    const userOperationsValidationFailure = new Counter({
        name: "alto_user_operations_validation_failure_count",
        help: "Number of user operations failed to validate",
        labelNames: ["chainId"] as const
    })

    registry.registerMetric(walletsAvailable)
    registry.registerMetric(walletsTotal)
    registry.registerMetric(userOperationsBundlesIncluded)
    registry.registerMetric(userOperationsBundlesSubmitted)
    registry.registerMetric(userOperationsReceived)
    registry.registerMetric(userOperationsValidationSuccess)
    registry.registerMetric(userOperationsValidationFailure)

    return {
        walletsAvailable: walletsAvailable.labels({ chainId }),
        walletsTotal: walletsTotal.labels({ chainId }),
        userOperationsBundlesIncluded: userOperationsBundlesIncluded.labels({ chainId }),
        userOperationsBundlesSubmitted: userOperationsBundlesSubmitted.labels({ chainId }),
        userOperationsReceived: userOperationsReceived.labels({ chainId }),
        userOperationsValidationSuccess: userOperationsValidationSuccess.labels({ chainId }),
        userOperationsValidationFailure: userOperationsValidationFailure.labels({ chainId })
    }
}
