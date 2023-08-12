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
        help: "Number of available executor wallets used to bundle"
    })

    const walletsTotal = new Gauge({
        name: "alto_executor_wallets_total_count",
        help: "Number of total executor wallets used to bundle"
    })

    const userOperationsBundlesIncluded = new Counter({
        name: "alto_user_operations_bundles_included_count",
        help: "Number of user operations bundles included on-chain"
    })

    const userOperationsBundlesSubmitted = new Counter({
        name: "alto_user_operations_bundles_submitted_count",
        help: "Number of user operations bundles submitted on-chain"
    })

    const userOperationsReceived = new Counter({
        name: "alto_user_operations_received_count",
        help: "Number of user operations received"
    })

    const userOperationsValidationSuccess = new Counter({
        name: "alto_user_operations_validation_success_count",
        help: "Number of user operations successfully validated"
    })

    const userOperationsValidationFailure = new Counter({
        name: "alto_user_operations_validation_failure_count",
        help: "Number of user operations failed to validate"
    })

    registry.registerMetric(walletsAvailable)
    registry.registerMetric(walletsTotal)
    registry.registerMetric(userOperationsBundlesIncluded)
    registry.registerMetric(userOperationsBundlesSubmitted)
    registry.registerMetric(userOperationsReceived)
    registry.registerMetric(userOperationsValidationSuccess)
    registry.registerMetric(userOperationsValidationFailure)

    return {
        walletsAvailable,
        walletsTotal,
        userOperationsBundlesIncluded,
        userOperationsBundlesSubmitted,
        userOperationsReceived,
        userOperationsValidationSuccess,
        userOperationsValidationFailure
    }
}
