import type { Logger } from "@alto/utils"
import {
    type HttpTransport,
    type HttpTransportConfig,
    RpcRequestError,
    UrlRequiredError,
    createTransport,
    toFunctionSelector,
    getAbiItem,
    isHex,
    slice,
    type Hex
} from "viem"
import { formatAbiItem, getHttpRpcClient } from "viem/utils"
import {
    EntryPointV06Abi,
    EntryPointV06SimulationsAbi
} from "../types/contracts"
import type { RpcResponse, RpcRequest } from "viem/types/rpc"

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
    config: HttpTransportConfig & { logger: Logger }
): HttpTransport {
    const {
        fetchOptions,
        key = "http",
        name = "HTTP JSON-RPC",
        retryDelay,
        logger
    } = config

    return ({ chain, retryCount: retryCount_, timeout: timeout_ }) => {
        const retryCount = config.retryCount ?? retryCount_
        const timeout = timeout_ ?? config.timeout ?? 10_000
        const url = url_ || chain?.rpcUrls.default.http[0]
        if (!url) {
            throw new UrlRequiredError()
        }

        return createTransport(
            {
                key,
                name,
                async request({ method, params }) {
                    let body: RpcRequest = { method, params }
                    let rawResponse: RpcResponse | undefined = undefined

                    const { error, result } = await getHttpRpcClient(
                        url
                    ).request({
                        body: body,
                        fetchOptions,
                        timeout,
                        onRequest: async (request) => {
                            body = await request.clone().json()
                        },
                        onResponse: async (response) => {
                            rawResponse = await response.clone().json()
                        }
                    })

                    if (error) {
                        let loggerFn = logger.error.bind(logger)

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

                        loggerFn(
                            {
                                err: error,
                                rawResponse: rawResponse ?? {},
                                body
                            },
                            "received error response"
                        )

                        throw new RpcRequestError({
                            body,
                            error: {
                                ...error,
                                // 24 Aug 2024, etherlink throws -32003 error code for eth_call
                                code:
                                    method === "eth_call" &&
                                    error.code === -32003
                                        ? 3
                                        : error.code
                            },
                            url: url
                        })
                    }
                    logger.info({ body, result }, "received response")
                    return result
                },
                retryCount,
                retryDelay,
                timeout,
                type: "http"
            },
            {
                fetchOptions,
                url
            }
        )
    }
}
