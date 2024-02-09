import type { Metrics } from "@alto/utils"
import {
    type JSONRPCResponse,
    bundlerRequestSchema,
    jsonRpcSchema
} from "@entrypoint-0.6/types"
import { RpcError, ValidationErrors } from "@entrypoint-0.6/types"
import type { Logger } from "@alto/utils"
import * as sentry from "@sentry/node"
import Fastify, {
    type FastifyBaseLogger,
    type FastifyInstance,
    type FastifyReply,
    type FastifyRequest
} from "fastify"
import type { Registry } from "prom-client"
import { toHex } from "viem"
import { fromZodError } from "zod-validation-error"
import type { IRpcEndpoint } from "./rpcHandler"

// jsonBigIntOverride.ts
const originalJsonStringify = JSON.stringify

JSON.stringify = (
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    value: any,
    replacer?: // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    ((this: any, key: string, value: any) => any) | (string | number)[] | null,
    space?: string | number
): string => {
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    const bigintReplacer = (_key: string, value: any): any => {
        if (typeof value === "bigint") {
            return toHex(value)
        }
        return value
    }

    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    const wrapperReplacer = (key: string, value: any): any => {
        if (typeof replacer === "function") {
            // biome-ignore lint: no other way to do this
            value = replacer(key, value)
        } else if (Array.isArray(replacer)) {
            if (!replacer.includes(key)) {
                return
            }
        }
        return bigintReplacer(key, value)
    }

    return originalJsonStringify(value, wrapperReplacer, space)
}

declare module "fastify" {
    interface FastifyRequest {
        rpcMethod: string
    }

    interface FastifyReply {
        rpcStatus: "failed" | "success"
    }
}

export class Server {
    private fastify: FastifyInstance
    private rpcEndpoint: IRpcEndpoint
    private port: number
    private registry: Registry
    private metrics: Metrics

    constructor(
        rpcEndpoint: IRpcEndpoint,
        port: number,
        requestTimeout: number | undefined,
        logger: Logger,
        registry: Registry,
        metrics: Metrics
    ) {
        this.fastify = Fastify({
            logger: logger as FastifyBaseLogger, // workaround for https://github.com/fastify/fastify/issues/4960
            requestTimeout: requestTimeout,
            disableRequestLogging: true
        })

        this.fastify.register(require("fastify-cors"), {
            origin: "*",
            methods: ["POST", "GET", "OPTIONS"]
        })

        this.fastify.decorateRequest("rpcMethod", null)
        this.fastify.decorateReply("rpcStatus", null)

        this.fastify.addHook("onResponse", (request, reply) => {
            const ignoredRoutes = ["/health", "/metrics"]
            if (ignoredRoutes.includes(request.routeOptions.url)) {
                return
            }

            const labels = {
                route: request.routeOptions.url,
                code: reply.statusCode,
                method: request.method,
                rpc_method: request.rpcMethod,
                rpc_status: reply.rpcStatus
            }

            this.metrics.httpRequests.labels(labels).inc()

            const durationMs = reply.getResponseTime()
            const durationSeconds = durationMs / 1000
            this.metrics.httpRequestsDuration
                .labels(labels)
                .observe(durationSeconds)
        })

        this.fastify.post("/rpc", this.rpc.bind(this))
        this.fastify.post("/", this.rpc.bind(this))
        this.fastify.get("/health", this.healthCheck.bind(this))
        this.fastify.get("/metrics", this.serveMetrics.bind(this))

        this.rpcEndpoint = rpcEndpoint
        this.port = port
        this.registry = registry
        this.metrics = metrics
    }

    public start(): void {
        this.fastify.listen({ port: this.port, host: "0.0.0.0" })
    }

    public async stop(): Promise<void> {
        await this.fastify.close()
    }

    public async healthCheck(
        _request: FastifyRequest,
        reply: FastifyReply
    ): Promise<void> {
        await reply.status(200).send("OK")
    }

    public async rpc(
        request: FastifyRequest,
        reply: FastifyReply
    ): Promise<void> {
        reply.rpcStatus = "failed" // default to failed
        let requestId: number | null = null
        try {
            const contentTypeHeader = request.headers["content-type"]
            if (contentTypeHeader !== "application/json") {
                throw new RpcError(
                    "invalid content-type, content-type must be application/json",
                    ValidationErrors.InvalidFields
                )
            }
            this.fastify.log.trace(
                { body: JSON.stringify(request.body) },
                "received request"
            )
            //const jsonRpcResponse = await this.innerRpc(request.body)

            const jsonRpcParsing = jsonRpcSchema.safeParse(request.body)
            if (!jsonRpcParsing.success) {
                const validationError = fromZodError(jsonRpcParsing.error)
                throw new RpcError(
                    `invalid JSON-RPC request ${validationError.message}`,
                    ValidationErrors.InvalidFields
                )
            }

            const jsonRpcRequest = jsonRpcParsing.data

            requestId = jsonRpcRequest.id

            const bundlerRequestParsing =
                bundlerRequestSchema.safeParse(jsonRpcRequest)
            if (!bundlerRequestParsing.success) {
                const validationError = fromZodError(
                    bundlerRequestParsing.error
                )
                throw new RpcError(
                    validationError.message,
                    ValidationErrors.InvalidRequest
                )
            }

            const bundlerRequest = bundlerRequestParsing.data
            request.rpcMethod = bundlerRequest.method
            this.fastify.log.info(
                {
                    data: JSON.stringify(bundlerRequest, null),
                    method: bundlerRequest.method
                },
                "incoming request"
            )
            const result = await this.rpcEndpoint.handleMethod(bundlerRequest)
            const jsonRpcResponse: JSONRPCResponse = {
                jsonrpc: "2.0",
                id: jsonRpcRequest.id,
                result: result.result
            }

            await reply.status(200).send(jsonRpcResponse)
            reply.rpcStatus = "success"
            this.fastify.log.info(
                {
                    data: JSON.stringify(jsonRpcResponse),
                    method: bundlerRequest.method
                },
                "sent reply"
            )
        } catch (err) {
            if (err instanceof RpcError) {
                const rpcError = {
                    jsonrpc: "2.0",
                    id: requestId,
                    error: {
                        message: err.message,
                        data: err.data,
                        code: err.code
                    }
                }
                await reply.status(200).send(rpcError)
                this.fastify.log.info(rpcError, "error reply")
            } else if (err instanceof Error) {
                sentry.captureException(err)
                const rpcError = {
                    jsonrpc: "2.0",
                    id: requestId,
                    error: {
                        message: err.message
                    }
                }

                await reply.status(500).send(rpcError)
                this.fastify.log.error(err, "error reply (non-rpc)")
            } else {
                const rpcError = {
                    jsonrpc: "2.0",
                    id: requestId,
                    error: {
                        message: "Unknown error"
                    }
                }

                await reply.status(500).send(rpcError)
                this.fastify.log.info(reply.raw, "error reply (non-rpc)")
            }
        }
    }

    public async serveMetrics(
        _request: FastifyRequest,
        reply: FastifyReply
    ): Promise<void> {
        reply.headers({ "Content-Type": this.registry.contentType })
        const metrics = await this.registry.metrics()
        await reply.send(metrics)
    }
}
