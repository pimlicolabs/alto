import {
    Counter,
    Gauge,
    Histogram,
    type Registry,
    collectDefaultMetrics
} from "prom-client"

export type Metrics = ReturnType<typeof createMetrics>

export function createMetrics(registry: Registry, register = true) {
    // Skip default metrics collection in development mode or when running in Bun
    // to avoid compatibility issues
    const isBun = typeof (globalThis as any).Bun !== "undefined"

    if (!isBun) {
        collectDefaultMetrics({ register: registry })
    }

    const registers = register ? [registry] : []

    const httpRequests = new Counter({
        name: "alto_requests_total",
        help: "Total number of requests",
        labelNames: [
            "route",
            "rpc_method",
            "rpc_status",
            "code",
            "method"
        ] as const,
        registers
    })

    const httpRequestsDuration = new Histogram({
        name: "alto_requests_duration_seconds",
        help: "Duration of requests in seconds",
        labelNames: [
            "route",
            "rpc_method",
            "rpc_status",
            "code",
            "method",
            "api_version"
        ] as const,
        registers
    })

    const userOpsInMempool = new Gauge({
        name: "alto_user_operations_in_mempool_count",
        help: "Number of user operations in mempool",
        labelNames: ["status"] as const,
        registers
    })

    const walletsAvailable = new Gauge({
        name: "alto_executor_wallets_available_count",
        help: "Number of available executor wallets used to bundle",
        labelNames: [] as const,
        registers
    })

    const walletsTotal = new Gauge({
        name: "alto_executor_wallets_total_count",
        help: "Number of total executor wallets used to bundle",
        labelNames: [] as const,
        registers
    })

    const userOpsOnChain = new Counter({
        name: "alto_user_operations_on_chain_total",
        help: "Number of user operations on-chain by status",
        labelNames: ["status"] as const,
        registers
    })

    const userOpsSubmitted = new Counter({
        name: "alto_user_operations_submitted_total",
        help: "Number of user operations bundles submitted on-chain",
        labelNames: ["status"] as const,
        registers
    })

    const bundlesIncluded = new Counter({
        name: "alto_bundles_included_total",
        help: "Number of user operations bundles included on-chain",
        labelNames: [] as const,
        registers
    })

    const bundlesSubmitted = new Counter({
        name: "alto_bundles_submitted_total",
        help: "Number of user operations bundles submitted on-chain",
        labelNames: ["status"] as const,
        registers
    })

    const userOpsReceived = new Counter({
        name: "alto_user_operations_received_total",
        help: "Number of user operations received",
        labelNames: ["status", "type"] as const,
        registers
    })

    const userOpsValidationSuccess = new Counter({
        name: "alto_user_operations_validation_success_total",
        help: "Number of user operations successfully validated",
        labelNames: [] as const,
        registers
    })

    const userOpsValidationFailure = new Counter({
        name: "alto_user_operations_validation_failure_total",
        help: "Number of user operations failed to validate",
        labelNames: [] as const,
        registers
    })

    const userOpInclusionDuration = new Histogram({
        name: "alto_user_operation_inclusion_duration_seconds",
        help: "Duration from receiving a user operation to seeing the block that included it",
        labelNames: [] as const,
        registers,
        buckets: [
            0.5, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 40, 50, 60, 120,
            180, 240, 300, 600, 900, 1200
        ]
    })

    const chainBlockTime = new Gauge({
        name: "alto_chain_block_time_seconds",
        help: "Configured block time of the chain in seconds",
        labelNames: [] as const,
        registers
    })

    const userOpInclusionDurationBlocks = new Histogram({
        name: "alto_user_operation_inclusion_duration_blocks",
        help: "Number of blocks from receiving a user operation to seeing the block that included it",
        labelNames: [] as const,
        registers,
        buckets: [
            0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75,
            100, 150, 200, 300
        ]
    })

    const verificationGasLimitEstimationTime = new Histogram({
        name: "alto_verification_gas_limit_estimation_time_seconds",
        help: "Total duration of verification gas limit estimation",
        labelNames: [] as const,
        registers,
        buckets: [0.1, 0.2, 0.3, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5]
    })

    const verificationGasLimitEstimationCount = new Histogram({
        name: "alto_verification_gas_limit_estimation_count",
        help: "Number of verification gas limit estimation calls",
        labelNames: [] as const,
        registers,
        buckets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    })

    const replacedTransactions = new Counter({
        name: "alto_replaced_transactions_total",
        help: "Number of replaced transactions",
        labelNames: ["reason", "status"] as const,
        registers
    })

    const userOpsResubmitted = new Counter({
        name: "alto_user_operations_resubmitted_total",
        help: "Number of user operations resubmitted",
        labelNames: [] as const,
        registers
    })

    const userOpsDropped = new Counter({
        name: "alto_user_operations_dropped_total",
        help: "Number of user operations dropped from mempool",
        labelNames: ["reason"] as const,
        registers
    })

    const userOpsSubmissionAttempts = new Histogram({
        name: "alto_user_operations_attempts_before_inclusion",
        help: "Number of submission attempts needed before a user operation was included on-chain",
        labelNames: [] as const,
        registers
    })

    const utilityWalletBalance = new Gauge({
        name: "alto_utility_wallet_balance",
        help: "Balance of the utility wallet",
        labelNames: [] as const,
        registers
    })

    const utilityWalletInsufficientBalance = new Gauge({
        name: "alto_utility_wallet_insufficient_balance",
        help: "Indicates if the utility wallet could not cover the last refill pass (0=OK, 1=insufficient)",
        labelNames: [] as const,
        registers
    })

    // How much the utility wallet is missing to fully cover executor refills
    // Expressed in ETH for readability, consistent with other balance gauges
    const utilityWalletMissingBalance = new Gauge({
        name: "alto_utility_wallet_missing_balance",
        help: "ETH missing to fully refill executor wallets (0 if sufficient)",
        labelNames: [] as const,
        registers
    })

    // Gauges default to 0, we remove the default value here.
    utilityWalletBalance.remove()
    utilityWalletInsufficientBalance.remove()
    utilityWalletMissingBalance.remove()

    const executorWalletsBalances = new Gauge({
        name: "alto_executor_wallet_balance",
        help: "Balance of the executor wallet",
        labelNames: ["wallet"] as const,
        registers
    })

    const executorWalletsMinBalance = new Gauge({
        name: "alto_executor_wallets_min_balance",
        help: "Minimum balance of the executor wallets",
        labelNames: [] as const,
        registers
    })

    const executorWalletsRequiredBalance = new Gauge({
        name: "alto_executor_wallets_required_balance",
        help: "Total minimum balance required across all executor wallets",
        labelNames: [] as const,
        registers
    })

    const walletsProcessingTime = new Histogram({
        name: "alto_executor_wallets_processing_duration_seconds",
        help: "Time spent processing user operations by executor wallets",
        labelNames: [] as const,
        registers
    })

    // === userOp journey timings === //
    // `attempt` is one of USER_OP_ATTEMPT_LABELS, see getUserOpAttemptLabel.
    const userOpStageDuration = new Histogram({
        name: "alto_user_operation_stage_duration_seconds",
        help: "Duration of each stage of a user operation's journey through the bundler",
        labelNames: ["stage", "attempt"] as const,
        registers,
        buckets: [
            0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1,
            1.5, 2, 3, 5, 7.5, 10, 15, 20, 30, 60, 120, 300
        ]
    })

    const userOpEndToEndDuration = new Histogram({
        name: "alto_user_operation_end_to_end_duration_seconds",
        help: "Duration from receiving a user operation to processing its inclusion receipt",
        labelNames: ["attempt"] as const,
        registers,
        buckets: [
            0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15,
            20, 30, 60, 120, 300, 600
        ]
    })

    // `attempt` is "first" for a new bundle tx, "replacement" when
    // replacing a pending bundle tx.
    const bundlePrepareStepDuration = new Histogram({
        name: "alto_bundle_prepare_step_duration_seconds",
        help: "Duration of each step between popping user operations from the mempool and the bundle transaction being accepted by the node",
        labelNames: ["step", "attempt"] as const,
        registers,
        buckets: [
            0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3,
            0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 30
        ]
    })

    const bundleSendTransactionRetries = new Histogram({
        name: "alto_bundle_send_transaction_retries",
        help: "Number of failed sendTransaction calls before a bundle transaction was accepted (or gave up)",
        labelNames: ["attempt", "result"] as const,
        registers,
        buckets: [0, 1, 2, 3, 4, 5, 7, 10]
    })

    const handleBlockDuration = new Histogram({
        name: "alto_executor_handle_block_duration_seconds",
        help: "Duration of handling a new block while bundles are pending",
        labelNames: [] as const,
        registers,
        buckets: [
            0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2,
            3, 5, 10, 30
        ]
    })

    const handleBlockSkipped = new Counter({
        name: "alto_executor_handle_block_skipped_total",
        help: "Number of block events skipped because the previous block was still being handled",
        labelNames: [] as const,
        registers
    })

    // === send transaction RPC fan-out (multiRpcTransport) === //
    // `endpoint` is the URL hostname only, never the path or query.
    const sendTransactionRpcDuration = new Histogram({
        name: "alto_send_transaction_rpc_duration_seconds",
        help: "Duration of each send transaction RPC endpoint's response",
        labelNames: ["method", "endpoint", "result"] as const,
        registers,
        buckets: [
            0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1,
            1.5, 2, 3, 5, 10
        ]
    })

    const sendTransactionRpcWins = new Counter({
        name: "alto_send_transaction_rpc_wins_total",
        help: "Number of times each send transaction RPC endpoint answered first successfully",
        labelNames: ["method", "endpoint"] as const,
        registers
    })

    const altoSecondValidationFailed = new Counter({
        name: "alto_second_validation_failed",
        help: "Number of times alto's second estimation failed during eth_estimateUserOperationGas and we returned 2x gas limits",
        labelNames: [] as const,
        registers
    })

    return {
        httpRequests,
        httpRequestsDuration,
        userOpsInMempool,
        walletsAvailable,
        walletsTotal,
        userOpsOnChain,
        userOpsSubmitted,
        bundlesIncluded,
        bundlesSubmitted,
        userOpsReceived,
        userOpsValidationSuccess,
        userOpsValidationFailure,
        userOpInclusionDuration,
        userOpInclusionDurationBlocks,
        chainBlockTime,
        verificationGasLimitEstimationTime,
        verificationGasLimitEstimationCount,
        replacedTransactions,
        userOpsResubmitted,
        userOpsDropped,
        utilityWalletBalance,
        utilityWalletInsufficientBalance,
        utilityWalletMissingBalance,
        executorWalletsBalances,
        executorWalletsMinBalance,
        executorWalletsRequiredBalance,
        walletsProcessingTime,
        userOpsSubmissionAttempts,
        userOpStageDuration,
        userOpEndToEndDuration,
        bundlePrepareStepDuration,
        bundleSendTransactionRetries,
        handleBlockDuration,
        handleBlockSkipped,
        sendTransactionRpcDuration,
        sendTransactionRpcWins,
        altoSecondValidationFailed
    }
}

export type UserOpStage =
    | "validation"
    | "mempool_wait"
    | "pickup_to_submitted"
    | "submitted_to_block_seen"
    | "block_seen_to_processed"

export type BundlePrepareStep =
    | "get_bundles"
    | "wallet_acquire"
    | "gas_and_nonce_fetch"
    | "filter_ops_simulation"
    | "send_transaction"
    | "send_transaction_with_retries"
    | "total"

// "first": first pass through the bundler.
// "resubmit": the userOp went back to the mempool after an earlier attempt
// (failed bundle, reorg, ...).
// "replacement": included via a replacement of its bundle transaction.
export type UserOpAttemptLabel = "first" | "resubmit" | "replacement"

export const getUserOpAttemptLabel = ({
    priorSubmissionAttempts,
    replaced = false
}: {
    priorSubmissionAttempts: number
    replaced?: boolean
}): UserOpAttemptLabel => {
    if (replaced) {
        return "replacement"
    }
    return priorSubmissionAttempts > 0 ? "resubmit" : "first"
}

// Observes `endMs - startMs` in seconds. Timestamps may be missing on
// userOps written by older bundler versions, the observation is skipped then.
export const observeDurationMs = ({
    histogram,
    startMs,
    endMs
}: {
    histogram: { observe: (value: number) => void }
    startMs: number | undefined
    endMs: number
}) => {
    if (startMs === undefined || endMs < startMs) {
        return
    }
    histogram.observe((endMs - startMs) / 1000)
}
