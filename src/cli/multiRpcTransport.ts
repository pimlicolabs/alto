import type { Logger, Metrics } from "@alto/utils"
import {
    type EIP1193RequestFn,
    type HttpTransportConfig,
    type Transport,
    createTransport,
    numberToHex
} from "viem"
import { customTransport } from "./customTransport"

// Only these methods are timed, to keep metric cardinality bounded.
const TIMED_METHODS = new Set(["eth_sendRawTransaction"])

// Metric label for an endpoint. Hostname only: URL paths and queries can
// contain API keys.
const getEndpointLabel = (url: string): string => {
    try {
        return new URL(url).hostname || "unknown"
    } catch {
        return "unknown"
    }
}

// Fans out every request to all urls in parallel, resolving with the first
// successful response and rejecting only if every endpoint fails. Fanning out
// non-send methods too keeps a lagging or method-restricted endpoint (e.g. a
// sequencer that only accepts eth_sendRawTransaction) from stalling requests.
// eth_chainId is answered locally: viem calls it before every sendTransaction
// and some endpoints don't allow it.
export function multiRpcTransport(
    urls: string[],
    config: HttpTransportConfig & {
        logger: Logger
        chainId: number
        metrics: Metrics
    }
): Transport {
    const {
        key = "multiRpc",
        name = "Multi RPC JSON-RPC",
        logger,
        chainId,
        metrics
    } = config
    const endpoints = urls.map(getEndpointLabel)

    return ({ chain, retryCount, timeout }) => {
        const transports = urls.map((url) =>
            customTransport(url, {
                ...config,
                logger: logger.child({ sendTransactionRpcUrl: url })
            })({ chain, retryCount: 0, timeout })
        )

        return createTransport({
            key,
            name,
            request: (async ({
                method,
                params
            }: {
                method: string
                params?: unknown
            }) => {
                if (method === "eth_chainId") {
                    return numberToHex(chainId)
                }

                const isTimed = TIMED_METHODS.has(method)

                const sends = transports.map(async (transport, index) => {
                    const start = performance.now()
                    const observe = (result: "success" | "error") => {
                        if (!isTimed) {
                            return
                        }
                        metrics.sendTransactionRpcDuration
                            .labels({
                                method,
                                endpoint: endpoints[index],
                                result
                            })
                            .observe((performance.now() - start) / 1000)
                    }

                    const send = transport.request({ method, params })
                    // Handle every rejection eagerly so an endpoint failing
                    // after another already succeeded can never become an
                    // unhandled rejection.
                    send.then(
                        () => observe("success"),
                        (err: unknown) => {
                            observe("error")
                            logger.warn(
                                { err, url: urls[index], method },
                                "multi rpc endpoint request failed"
                            )
                        }
                    )
                    return { index, response: await send }
                })

                try {
                    const { index, response } = await Promise.any(sends)
                    if (isTimed) {
                        metrics.sendTransactionRpcWins
                            .labels({ method, endpoint: endpoints[index] })
                            .inc()
                    }
                    return response
                } catch (err) {
                    // Rethrow the first endpoint's error instead of the
                    // AggregateError so viem's error classification (nonce
                    // too low, underpriced, ...) keeps working.
                    if (err instanceof AggregateError) {
                        throw err.errors[0]
                    }
                    throw err
                }
            }) as EIP1193RequestFn,
            retryCount: config.retryCount ?? retryCount,
            timeout,
            type: "http"
        })
    }
}
