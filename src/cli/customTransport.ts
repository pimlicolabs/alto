import type { Logger } from "@alto/utils"
import { WebSocket } from "ws"
import {
    type HttpTransportConfig,
    RpcRequestError,
    UrlRequiredError,
    createTransport,
    toFunctionSelector,
    getAbiItem,
    isHex,
    slice,
    type Hex,
    type WebSocketTransportConfig,
    type Transport,
    type EIP1193RequestFn
} from "viem"
import { formatAbiItem, getHttpRpcClient } from "viem/utils"
import {
    EntryPointV06Abi,
    EntryPointV06SimulationsAbi
} from "../types/contracts"

export type RpcRequest = {
    jsonrpc?: "2.0" | undefined
    method: string
    params?: any | undefined
    id?: number | undefined
}

const EXECUTION_RESULT_SELECTOR = toFunctionSelector(
    formatAbiItem(
        getAbiItem({
            abi: EntryPointV06Abi,
            name: "ExecutionResult"
        })
    )
)

const VALIDATION_RESULT_SELECTOR = toFunctionSelector(
    formatAbiItem(
        getAbiItem({
            abi: EntryPointV06Abi,
            name: "ValidationResult"
        })
    )
)

const FAILED_OP_SELECTOR = toFunctionSelector(
    formatAbiItem(
        getAbiItem({
            abi: EntryPointV06Abi,
            name: "FailedOp"
        })
    )
)

// custom selector for when code overrides are used.
const CALLPHASE_REVERTED_SELECTOR = toFunctionSelector(
    formatAbiItem(
        getAbiItem({
            abi: EntryPointV06SimulationsAbi,
            name: "CallPhaseReverted"
        })
    )
)

export function customTransport(
    /** URL of the JSON-RPC API. Defaults to the chain's public RPC URL. */
    url_: string,
    config: { logger: Logger } & (
        | HttpTransportConfig
        | WebSocketTransportConfig
    )
): Transport {
    const isWebSocketUrl =
        url_?.startsWith("ws://") || url_?.startsWith("wss://")
    const type = isWebSocketUrl ? "webSocket" : "http"
    const {
        key = type === "http" ? "http" : "webSocket",
        name = type === "http" ? "HTTP JSON-RPC" : "WebSocket JSON-RPC",
        retryDelay,
        logger
    } = config
    const fetchOptions =
        "fetchOptions" in config ? config.fetchOptions : undefined

    return ({ chain, retryCount: retryCount_, timeout: timeout_ }) => {
        const retryCount = config.retryCount ?? retryCount_
        const timeout = timeout_ ?? config.timeout ?? 10_000
        const url =
            url_ ||
            (type === "webSocket"
                ? chain?.rpcUrls.default.webSocket?.[0]
                : chain?.rpcUrls.default.http?.[0])

        if (!url) {
            throw new UrlRequiredError()
        }

        if (type === "webSocket") {
            let ws: WebSocket | undefined
            let requestId = 0
            const pendingRequests: Record<number, (val: any) => void> = {}

            function getSocket() {
                if (ws?.readyState === WebSocket.OPEN) return ws
                ws = new WebSocket(url as string)

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data as string)
                        const callback = pendingRequests[data.id]
                        if (callback) {
                            callback(data)
                            delete pendingRequests[data.id]
                        }
                    } catch (error) {
                        logger.error(
                            { error },
                            "Error parsing WebSocket message"
                        )
                    }
                }

                ws.onerror = (error) => {
                    logger.error({ error }, "WebSocket error")
                }

                ws.onclose = () => {
                    logger.info("WebSocket connection closed")
                    ws = undefined
                }

                return ws
            }

            return createTransport(
                {
                    key,
                    name,
                    type: "webSocket",
                    retryCount,
                    retryDelay,
                    timeout,
                    request: (async ({
                        method,
                        params
                    }: { method: string; params: unknown }) => {
                        const socket = getSocket()
                        const id = ++requestId
                        const body: RpcRequest = {
                            jsonrpc: "2.0",
                            id,
                            method,
                            params
                        }

                        logger.info({ body }, "sending WebSocket request")
                        return new Promise((resolve) => {
                            pendingRequests[id] = (response) => {
                                logger.info(
                                    { body, response },
                                    "received WebSocket response"
                                )
                                if (response.error) {
                                    handleRpcError({
                                        error: response.error,
                                        body,
                                        method,
                                        url,
                                        logger
                                    })
                                }
                                resolve(response.result)
                            }
                            socket.send(JSON.stringify(body))
                        })
                    }) as unknown as EIP1193RequestFn
                },
                {
                    url
                }
            )
        }

        // HTTP implementation (default)
        return createTransport(
            {
                key,
                name,
                type: "http",
                retryCount,
                retryDelay,
                timeout,

                async request({ method, params }) {
                    const body: RpcRequest = { method, params }

                    const fn = async (body: RpcRequest) => {
                        return await getHttpRpcClient(url).request({
                            body,
                            fetchOptions,
                            timeout
                        })
                    }

                    const { error, result } = await fn(body)

                    if (error) {
                        handleRpcError({ error, body, method, url, logger })
                    }

                    logger.info({ body, result }, "received response")
                    return result
                }
            },
            {
                fetchOptions,
                url
            }
        )
    }
}

function handleRpcError({
    error,
    body,
    method,
    url,
    logger
}: {
    error: any
    body: RpcRequest
    method: string
    url: string
    logger: Logger
}): never {
    let loggerFn = logger.error.bind(logger)

    // Check if the error data matches special selectors
    if (isHex(error?.data) && error?.data?.length > 10) {
        const errorSelector = slice(error?.data, 0, 4)

        if (
            [
                EXECUTION_RESULT_SELECTOR,
                VALIDATION_RESULT_SELECTOR,
                FAILED_OP_SELECTOR,
                CALLPHASE_REVERTED_SELECTOR
            ].includes(errorSelector as Hex)
        ) {
            loggerFn = logger.info.bind(logger)
        }
    }

    // Log the error with the appropriate logging function
    loggerFn(
        {
            err: error,
            body
        },
        "received error response"
    )

    // Throw a standardized RPC error
    throw new RpcRequestError({
        body,
        error: {
            ...error,
            // 24 Aug 2024, etherlink throws -32003 error code for eth_call
            code:
                method === "eth_call" && error.code === -32003 ? 3 : error.code
        },
        url
    })
}
