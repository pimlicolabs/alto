import {
    type BaseError,
    ContractFunctionExecutionError,
    ContractFunctionRevertedError,
    EstimateGasExecutionError,
    FeeCapTooLowError,
    InsufficientFundsError,
    InternalRpcError,
    IntrinsicGasTooLowError,
    NonceTooLowError,
    TransactionExecutionError
} from "viem"
import type { Logger } from "@alto/utils"
import * as sentry from "@sentry/node"

/**
 * Parses Viem errors and returns specific error types
 */
export function parseViemError(err: unknown) {
    if (
        err instanceof ContractFunctionExecutionError ||
        err instanceof TransactionExecutionError
    ) {
        const e = err.cause
        if (e instanceof NonceTooLowError) {
            return e
        }
        if (e instanceof FeeCapTooLowError) {
            return e
        }
        if (e instanceof InsufficientFundsError) {
            return e
        }
        if (e instanceof IntrinsicGasTooLowError) {
            return e
        }
        if (e instanceof ContractFunctionRevertedError) {
            return e
        }
        if (e instanceof EstimateGasExecutionError) {
            return e
        }
        if (e instanceof InternalRpcError) {
            return e
        }
    }
    return undefined
}

/**
 * Checks if an error is a transaction underpriced error
 */
export function isTransactionUnderpricedError(e: BaseError): boolean {
    const transactionUnderPriceError = e.walk((err: any) =>
        err?.message
            ?.toLowerCase()
            .includes("replacement transaction underpriced")
    )
    return transactionUnderPriceError !== null
}

/**
 * Standard error handler with logging and Sentry reporting
 */
export function handleError(
    error: unknown,
    logger: Logger,
    context: Record<string, any>,
    options?: {
        captureToSentry?: boolean
        rethrow?: boolean
    }
): void {
    const { captureToSentry = true, rethrow = false } = options || {}

    logger.error(
        {
            error: error instanceof Error ? error.message : String(error),
            ...context
        },
        "Error occurred"
    )

    if (captureToSentry && error instanceof Error) {
        sentry.captureException(error, {
            extra: context
        })
    }

    if (rethrow) {
        throw error
    }
}

/**
 * Retry helper for transient failures
 */
export async function retryAsync<T>(
    fn: () => Promise<T>,
    options: {
        maxAttempts?: number
        delay?: number
        backoff?: number
        shouldRetry?: (error: unknown) => boolean
        onRetry?: (attempt: number, error: unknown) => void
    } = {}
): Promise<T> {
    const {
        maxAttempts = 3,
        delay = 1000,
        backoff = 2,
        shouldRetry = () => true,
        onRetry
    } = options

    let lastError: unknown

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn()
        } catch (error) {
            lastError = error

            if (attempt === maxAttempts || !shouldRetry(error)) {
                throw error
            }

            if (onRetry) {
                onRetry(attempt, error)
            }

            const waitTime = delay * backoff ** (attempt - 1)
            await new Promise((resolve) => setTimeout(resolve, waitTime))
        }
    }

    throw lastError
}
