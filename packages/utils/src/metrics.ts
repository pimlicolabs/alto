import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client"

export type Metrics = ReturnType<typeof createMetrics>

export function createMetrics(
    registry: Registry,
) {
    collectDefaultMetrics({
        register: registry,
        prefix: "alto_",
        // eventLoopMonitoringPrecision with sampling rate in milliseconds
        eventLoopMonitoringPrecision: 10,
    })

    const httpRequests = new Counter({
        name: "alto_requests_total",
        help: "Total number of requests",
        labelNames: ["route", "network", "chainId", "rpc_method", "rpc_status", "code", "method"] as const,
        registers: [registry]
    })

    const httpRequestsDuration = new Histogram({
        name: "alto_requests_duration_seconds",
        help: "Duration of requests in seconds",
        labelNames: ["route", "network", "chainId", "rpc_method", "rpc_status", "code", "method", "api_version"] as const,
        registers: [registry]
    })

    const userOperationsInMempool = new Gauge({
        name: "alto_user_operations_in_mempool_count",
        help: "Number of user operations in mempool",
        labelNames: ["network", "chainId", "status"] as const,
        registers: [registry]
    })

    const walletsAvailable = new Gauge({
        name: "alto_executor_wallets_available_count",
        help: "Number of available executor wallets used to bundle",
        labelNames: ["network", "chainId"] as const,
        registers: [registry]
    })

    const walletsTotal = new Gauge({
        name: "alto_executor_wallets_total_count",
        help: "Number of total executor wallets used to bundle",
        labelNames: ["network", "chainId"] as const,
        registers: [registry]
    })

    const userOperationsIncluded = new Counter({
        name: "alto_user_operations_included_count",
        help: "Number of user operations bundles included on-chain",
        labelNames: ["network", "chainId"] as const,
        registers: [registry]
    })

    const userOperationsSubmitted = new Counter({
        name: "alto_user_operations_submitted_count",
        help: "Number of user operations bundles submitted on-chain",
        labelNames: ["network", "chainId"] as const,
        registers: [registry]
    })

    const bundlesIncluded = new Counter({
        name: "alto_bundles_included_count",
        help: "Number of user operations bundles included on-chain",
        labelNames: ["network", "chainId"] as const,
        registers: [registry]
    })

    const bundlesSubmitted = new Counter({
        name: "alto_bundles_submitted_count",
        help: "Number of user operations bundles submitted on-chain",
        labelNames: ["network", "chainId"] as const,
        registers: [registry]
    })

    const userOperationsReceived = new Counter({
        name: "alto_user_operations_received_count",
        help: "Number of user operations received",
        labelNames: ["network", "chainId"] as const,
        registers: [registry]
    })

    const userOperationsValidationSuccess = new Counter({
        name: "alto_user_operations_validation_success_count",
        help: "Number of user operations successfully validated",
        labelNames: ["network", "chainId"] as const,
        registers: [registry]
    })

    const userOperationsValidationFailure = new Counter({
        name: "alto_user_operations_validation_failure_count",
        help: "Number of user operations failed to validate",
        labelNames: ["network", "chainId"] as const,
        registers: [registry]
    })

    const userOperationInclusionDuration = new Histogram({
        name: "alto_user_operation_inclusion_duration_seconds",
        help: "Duration of user operation inclusion from first submission to inclusion on-chain",
        labelNames: ["network", "chainId"] as const,
        registers: [registry],
        buckets: [0.5, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 40, 50, 60, 120, 180, 240, 300, 600, 900, 1200]
    })

    const verificationGasLimitEstimationTime = new Histogram({
        name: "alto_verification_gas_limit_estimation_time_seconds",
        help: "Total duration of verification gas limit estimation",
        labelNames: ["network", "chainId"] as const,
        registers: [registry],
        buckets: [0.1, 0.2, 0.3, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5]
    })

    const verificationGasLimitEstimationCount = new Histogram({
        name: "alto_verification_gas_limit_estimation_count",
        help: "Number of verification gas limit estimation calls",
        labelNames: ["network", "chainId"] as const,
        registers: [registry],
        buckets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    })

    return {
        httpRequests,
        httpRequestsDuration,
        userOperationsInMempool,
        walletsAvailable,
        walletsTotal,
        userOperationsIncluded,
        userOperationsSubmitted,
        bundlesIncluded,
        bundlesSubmitted,
        userOperationsReceived,
        userOperationsValidationSuccess,
        userOperationsValidationFailure,
        userOperationInclusionDuration,
        verificationGasLimitEstimationTime,
        verificationGasLimitEstimationCount,
    }
}
