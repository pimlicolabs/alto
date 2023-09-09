import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client"

export type Metrics = ReturnType<typeof createMetrics>

export function createMetrics(
    registry: Registry,
    chainId: number,
    network: string,
    environment: string,
    register = true
) {
    collectDefaultMetrics({
        register: registry,
        prefix: "alto_",
        // eventLoopMonitoringPrecision with sampling rate in milliseconds
        eventLoopMonitoringPrecision: 10,
        labels: { network, chainId, environment }
    })

    const userOperationsInMempool = new Gauge({
        name: "alto_user_operations_in_mempool_count",
        help: "Number of user operations in mempool",
        labelNames: ["network", "chainId", "status"] as const,
        registers: []
    })

    const walletsAvailable = new Gauge({
        name: "alto_executor_wallets_available_count",
        help: "Number of available executor wallets used to bundle",
        labelNames: ["network", "chainId"] as const,
        registers: []
    })

    const walletsTotal = new Gauge({
        name: "alto_executor_wallets_total_count",
        help: "Number of total executor wallets used to bundle",
        labelNames: ["network", "chainId"] as const,
        registers: []
    })

    const userOperationsIncluded = new Counter({
        name: "alto_user_operations_included_count",
        help: "Number of user operations bundles included on-chain",
        labelNames: ["network", "chainId"] as const,
        registers: []
    })

    const userOperationsSubmitted = new Counter({
        name: "alto_user_operations_submitted_count",
        help: "Number of user operations bundles submitted on-chain",
        labelNames: ["network", "chainId"] as const,
        registers: []
    })

    const bundlesIncluded = new Counter({
        name: "alto_bundles_included_count",
        help: "Number of user operations bundles included on-chain",
        labelNames: ["network", "chainId"] as const,
        registers: []
    })

    const bundlesSubmitted = new Counter({
        name: "alto_bundles_submitted_count",
        help: "Number of user operations bundles submitted on-chain",
        labelNames: ["network", "chainId"] as const,
        registers: []
    })

    const userOperationsReceived = new Counter({
        name: "alto_user_operations_received_count",
        help: "Number of user operations received",
        labelNames: ["network", "chainId"] as const,
        registers: []
    })

    const userOperationsValidationSuccess = new Counter({
        name: "alto_user_operations_validation_success_count",
        help: "Number of user operations successfully validated",
        labelNames: ["network", "chainId"] as const,
        registers: []
    })

    const userOperationsValidationFailure = new Counter({
        name: "alto_user_operations_validation_failure_count",
        help: "Number of user operations failed to validate",
        labelNames: ["network", "chainId"] as const,
        registers: []
    })

    const userOperationInclusionDuration = new Histogram({
        name: "alto_user_operation_inclusion_duration_seconds",
        help: "Duration of user operation inclusion from first submission to inclusion on-chain",
        labelNames: ["network", "chainId"] as const,
        registers: [],
        buckets: [0.5, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 40, 50, 60, 120, 180, 240, 300, 600, 900, 1200]
    })

    const httpRequestDuration = new Histogram({
        name: "alto_http_request_duration_seconds",
        help: "Duration of HTTP requests",
        labelNames: ["network", "chainId", "status_code", "method"] as const,
        registers: [],
        buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 2, 3, 4, 5, 7.5, 10, 15, 20, 25, 30, 60, 120]
    })

    if (register) {
        registry.registerMetric(userOperationsInMempool)
        registry.registerMetric(walletsAvailable)
        registry.registerMetric(walletsTotal)
        registry.registerMetric(userOperationsIncluded)
        registry.registerMetric(userOperationsSubmitted)
        registry.registerMetric(bundlesIncluded)
        registry.registerMetric(bundlesSubmitted)
        registry.registerMetric(userOperationsReceived)
        registry.registerMetric(userOperationsValidationSuccess)
        registry.registerMetric(userOperationsValidationFailure)
        registry.registerMetric(userOperationInclusionDuration)
        registry.registerMetric(httpRequestDuration)
    }

    userOperationInclusionDuration.zero({ network, chainId })
    httpRequestDuration.zero({ network, chainId })
    httpRequestDuration.zero({ network, chainId, status_code: "500" })
    httpRequestDuration.zero({ network, chainId, status_code: "400" })
    httpRequestDuration.zero({ network, chainId, status_code: "200" })

    return {
        userOperationsInMempool: { metric: userOperationsInMempool, chainId, network },
        walletsAvailable: walletsAvailable.labels({ network, chainId }),
        walletsTotal: walletsTotal.labels({ network, chainId }),
        userOperationsIncluded: userOperationsIncluded.labels({ network, chainId }),
        userOperationsSubmitted: userOperationsSubmitted.labels({ network, chainId }),
        bundlesIncluded: bundlesIncluded.labels({ network, chainId }),
        bundlesSubmitted: bundlesSubmitted.labels({ network, chainId }),
        userOperationsReceived: userOperationsReceived.labels({ network, chainId }),
        userOperationsValidationSuccess: userOperationsValidationSuccess.labels({ network, chainId }),
        userOperationsValidationFailure: userOperationsValidationFailure.labels({ network, chainId }),
        userOperationInclusionDuration: userOperationInclusionDuration.labels({ network, chainId }),
        httpRequestDuration: { metric: httpRequestDuration, chainId, network }
    }
}
