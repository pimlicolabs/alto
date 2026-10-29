import type { Logger } from "@alto/utils"
import {
    BaseError,
    type EIP1193RequestFn,
    type HttpTransportConfig,
    MethodNotFoundRpcError,
    MethodNotSupportedRpcError,
    type Transport,
    createTransport,
    numberToHex
} from "viem"
import {
    SyncSendPendingError,
    isTransactionPendingError
} from "../executor/utils"
import { customTransport } from "./customTransport"

const isUnsupportedMethodError = (err: unknown): boolean =>
    err instanceof BaseError &&
    Boolean(
        err.walk(
            (e) =>
                e instanceof MethodNotFoundRpcError ||
                e instanceof MethodNotSupportedRpcError
        )
    )

// Fans out every request to all urls in parallel, resolving with the first
// successful response and rejecting only if every endpoint fails, or, for
// eth_sendRawTransactionSync, as soon as one says the transaction is pending
// (see SyncSendPendingError). Fanning out
// non-send methods too keeps a lagging or method-restricted endpoint (e.g. a
// sequencer that only accepts eth_sendRawTransaction) from stalling requests.
// eth_chainId is answered locally: viem calls it before every sendTransaction
// and some endpoints don't allow it.
export function multiRpcTransport(
    urls: string[],
    config: HttpTransportConfig & { logger: Logger; chainId: number }
): Transport {
    const {
        key = "multiRpc",
        name = "Multi RPC JSON-RPC",
        logger,
        chainId
    } = config

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

                const sends = transports.map((transport, index) => {
                    const send = transport.request({ method, params })
                    // Handle every rejection eagerly so an endpoint failing
                    // after another already succeeded can never become an
                    // unhandled rejection.
                    send.catch((err: unknown) => {
                        logger.warn(
                            { err, url: urls[index], method },
                            "multi rpc endpoint request failed"
                        )
                    })
                    return send
                })

                // An endpoint that already has the transaction (e.g. another
                // endpoint forwarded it first) answers without waiting for
                // its inclusion, while the others can take several blocks to
                // respond with the receipt. Hand their sends to the caller,
                // so it polls for the receipt meanwhile.
                const pending =
                    method === "eth_sendRawTransactionSync"
                        ? new Promise<never>((_, reject) => {
                              sends.forEach((send, index) => {
                                  send.catch((err: unknown) => {
                                      if (
                                          !(err instanceof BaseError) ||
                                          !isTransactionPendingError(err)
                                      ) {
                                          return
                                      }
                                      const others = sends.filter(
                                          (_, i) => i !== index
                                      )
                                      reject(
                                          new SyncSendPendingError({
                                              cause: err,
                                              receipt: Promise.any(
                                                  others
                                              ).catch(() => undefined)
                                          })
                                      )
                                  })
                              })
                          })
                        : undefined

                try {
                    const response = Promise.any(sends)
                    return await (pending
                        ? Promise.race([response, pending])
                        : response)
                } catch (err) {
                    // Rethrow one endpoint's error instead of the
                    // AggregateError so viem's error classification (nonce
                    // too low, underpriced, ...) keeps working. Skip
                    // endpoints that don't support the method (e.g. a
                    // sequencer rejecting eth_sendRawTransactionSync), their
                    // error says nothing about the transaction.
                    if (err instanceof AggregateError) {
                        throw (
                            err.errors.find(
                                (error) => !isUnsupportedMethodError(error)
                            ) ?? err.errors[0]
                        )
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
