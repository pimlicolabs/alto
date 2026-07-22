import type { Logger } from "@alto/utils"
import {
    BaseError,
    type EIP1193RequestFn,
    type HttpTransportConfig,
    RpcRequestError,
    type Transport,
    createTransport
} from "viem"
import { customTransport } from "./customTransport"

// Broadcasts eth_sendRawTransaction to all endpoints in parallel, resolving
// with the first successful response. Individual endpoint failures are
// swallowed unless every endpoint fails. All other methods fall through the
// endpoints sequentially.
export function broadcastTransport(
    urls: string[],
    config: HttpTransportConfig & { logger: Logger }
): Transport {
    return (opts) => {
        const transports = urls.map((url) =>
            customTransport(url, {
                ...config,
                logger: config.logger.child({ url })
            })({ ...opts, retryCount: 0 })
        )

        return createTransport({
            key: "broadcast",
            name: "Broadcast JSON-RPC",
            type: "broadcast",
            retryCount: config.retryCount ?? opts.retryCount,
            retryDelay: config.retryDelay,
            timeout: config.timeout ?? opts.timeout,
            request: (async ({ method, params }) => {
                if (method !== "eth_sendRawTransaction") {
                    let lastError: unknown
                    for (const transport of transports) {
                        try {
                            return await transport.request({ method, params })
                        } catch (err) {
                            lastError = err
                        }
                    }
                    throw lastError
                }

                try {
                    return await Promise.any(
                        transports.map((transport) =>
                            transport.request({ method, params })
                        )
                    )
                } catch (err) {
                    const { errors } = err as AggregateError
                    // Prefer an error the node actually responded with over
                    // a network-level failure so downstream classification
                    // (underpriced, fee too low, ...) keeps working.
                    const rpcError = errors.find(
                        (e) =>
                            e instanceof BaseError &&
                            e.walk((c) => c instanceof RpcRequestError) !== null
                    )
                    throw rpcError ?? errors[0]
                }
            }) as EIP1193RequestFn
        })
    }
}
