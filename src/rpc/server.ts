import {
    type ApiVersion,
    type JSONRPCResponse,
    RpcError,
    ValidationErrors,
    altoVersions,
    bundlerRequestSchema,
    jsonRpcSchema
} from "@alto/types"
import type { Metrics } from "@alto/utils"
import websocket from "@fastify/websocket"
import * as sentry from "@sentry/node"
import Fastify, {
    type FastifyBaseLogger,
    type FastifyInstance,
    type FastifyReply,
    type FastifyRequest
} from "fastify"
import type { Registry } from "prom-client"
import { toHex } from "viem"
import type * as WebSocket from "ws"
import { fromZodError } from "zod-validation-error"
import type { AltoConfig } from "../createConfig"
import rpcDecorators, { RpcStatus } from "../utils/fastify-rpc-decorators"
import RpcReply from "../utils/rpc-reply"
import type { RpcHandler } from "./rpcHandler"

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

export class Server {
    private config: AltoConfig
    private fastify: FastifyInstance
    private rpcEndpoint: RpcHandler
    private registry: Registry
    private metrics: Metrics

    constructor({
        config,
        rpcEndpoint,
        registry,
        metrics
    }: {
        config: AltoConfig
        rpcEndpoint: RpcHandler
        registry: Registry
        metrics: Metrics
    }) {
        this.config = config
        const logger = config.getLogger(
            { module: "rpc" },
            {
                level: config.rpcLogLevel || config.logLevel
            }
        )

        this.fastify = Fastify({
            logger: logger as FastifyBaseLogger, // workaround for https://github.com/fastify/fastify/issues/4960
            requestTimeout: config.timeout,
            disableRequestLogging: true
        })

        this.fastify.register(rpcDecorators)

        this.fastify.register(websocket, {
            options: {
                maxPayload: config.websocketMaxPayloadSize
            }
        })

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

            const durationMs = reply.elapsedTime
            const durationSeconds = durationMs / 1000
            this.metrics.httpRequestsDuration
                .labels(labels)
                .observe(durationSeconds)
        })

        this.fastify.post("/rpc", this.rpcHttp.bind(this))
        this.fastify.post("/:version/rpc", this.rpcHttp.bind(this))
        this.fastify.post("/", this.rpcHttp.bind(this))

        if (config.websocket) {
            this.fastify.register((fastify) => {
                fastify.route({
                    method: "GET",
                    url: "/:version/rpc",
                    handler: async (request, reply) => {
                        const version = (request.params as any).version

                        await reply
                            .status(404)
                            .send(
                                `GET request to /${version}/rpc is not supported, use POST isntead`
                            )
                    },
                    wsHandler: (socket: WebSocket.WebSocket, request) => {
                        socket.on("message", async (msgBuffer: Buffer) =>
                            this.rpcSocket(request, msgBuffer, socket)
                        )
                    }
                })
            })
        }

        this.fastify.get("/health", this.healthCheck.bind(this))
        this.fastify.get("/metrics", this.serveMetrics.bind(this))

        this.rpcEndpoint = rpcEndpoint
        this.registry = registry
        this.metrics = metrics
    }

    public start(): void {
        this.fastify.listen({ port: this.config.port, host: "0.0.0.0" })
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

    private async rpcSocket(
        request: FastifyRequest,
        msgBuffer: Buffer,
        socket: WebSocket.WebSocket
    ): Promise<void> {
        try {
            request.body = JSON.parse(msgBuffer.toString())
        } catch (err) {
            socket.send(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: null,
                    error: {
                        message: "invalid JSON-RPC request",
                        data: msgBuffer.toString(),
                        code: ValidationErrors.InvalidFields
                    }
                })
            )
            return
        }

        await this.rpc(request, RpcReply.fromSocket(socket))
    }

    private async rpcHttp(
        request: FastifyRequest,
        reply: FastifyReply
    ): Promise<void> {
        await this.rpc(request, RpcReply.fromHttpReply(reply))
    }

    private async rpc(request: FastifyRequest, reply: RpcReply): Promise<void> {
        let requestId: number | null = null

        const versionParsingResult = altoVersions.safeParse(
            (request.params as any)?.version ?? this.config.defaultApiVersion
        )

        if (!versionParsingResult.success) {
            const error = fromZodError(versionParsingResult.error)
            throw new RpcError(
                `invalid version ${error.message}`,
                ValidationErrors.InvalidFields
            )
        }

        const apiVersion: ApiVersion = versionParsingResult.data

        if (this.config.apiVersion.indexOf(apiVersion) === -1) {
            throw new RpcError(
                `unsupported version ${apiVersion}`,
                ValidationErrors.InvalidFields
            )
        }

        try {
            const contentTypeHeader = request.headers["content-type"]

            // Common browser websocket API does not allow setting custom headers
            if (
                contentTypeHeader !== "application/json" &&
                request.ws === false
            ) {
                throw new RpcError(
                    "invalid content-type, content-type must be application/json",
                    ValidationErrors.InvalidFields
                )
            }
            this.fastify.log.trace(
                { body: JSON.stringify(request.body) },
                "received request"
            )

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

                if (
                    validationError.message.includes(
                        "Missing/invalid userOpHash"
                    )
                ) {
                    throw new RpcError(
                        "Missing/invalid userOpHash",
                        ValidationErrors.InvalidFields
                    )
                }

                throw new RpcError(
                    validationError.message,
                    ValidationErrors.InvalidRequest
                )
            }

            const bundlerRequest = bundlerRequestParsing.data
            request.rpcMethod = bundlerRequest.method

            if (
                this.config.rpcMethods !== null &&
                !this.config.rpcMethods.includes(bundlerRequest.method)
            ) {
                throw new RpcError(
                    `Method not supported: ${bundlerRequest.method}`,
                    ValidationErrors.InvalidRequest
                )
            }

            this.fastify.log.info(
                {
                    data: JSON.stringify(bundlerRequest, null),
                    method: bundlerRequest.method
                },
                "incoming request"
            )
            const result = await this.rpcEndpoint.handleMethod(
                bundlerRequest,
                apiVersion
            )
            const jsonRpcResponse: JSONRPCResponse = {
                jsonrpc: "2.0",
                id: jsonRpcRequest.id,
                result
            }

            await reply
                .setRpcStatus(RpcStatus.Success)
                .status(200)
                .send(jsonRpcResponse)

            this.fastify.log.info(
                {
                    data:
                        bundlerRequest.method ===
                            "eth_getUserOperationReceipt" &&
                        jsonRpcResponse.result
                            ? {
                                  ...jsonRpcResponse,
                                  result: "<reduced>"
                              }
                            : jsonRpcResponse, // do not log the full result for eth_getUserOperationReceipt to reduce log size
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
                await reply
                    .setRpcStatus(RpcStatus.ClientError)
                    .status(200)
                    .send(rpcError)
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

                await reply
                    .setRpcStatus(RpcStatus.ServerError)
                    .status(500)
                    .send(rpcError)
                this.fastify.log.error(err, "error reply (non-rpc)")
            } else {
                const rpcError = {
                    jsonrpc: "2.0",
                    id: requestId,
                    error: {
                        message: "Unknown error"
                    }
                }

                await reply
                    .setRpcStatus(RpcStatus.ServerError)
                    .status(500)
                    .send(rpcError)
                this.fastify.log.error(
                    { err },
                    "error reply (unhandled error type)"
                )
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
