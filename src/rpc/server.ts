import {
    RpcError,
    ValidationErrors,
    bundlerRequestSchema,
    jsonRpcSchema,
    altoVersions,
    type ApiVersion,
    type JSONRPCResponse
} from "@alto/types"
import type { Logger, Metrics } from "@alto/utils"
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
import websocket from "@fastify/websocket"
import RpcReply from "../utils/rpc-reply"
import type * as WebSocket from "ws"

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
    private apiVersions: ApiVersion[]
    private defaultApiVersion: ApiVersion

    constructor(
        rpcEndpoint: IRpcEndpoint,
        apiVersions: ApiVersion[],
        defaultApiVersion: ApiVersion,
        port: number,
        requestTimeout: number | undefined,
        websocketMaxPayloadSize: number,
        websocketEnabled: boolean,
        logger: Logger,
        registry: Registry,
        metrics: Metrics
    ) {
        this.fastify = Fastify({
            logger: logger as FastifyBaseLogger, // workaround for https://github.com/fastify/fastify/issues/4960
            requestTimeout: requestTimeout,
            disableRequestLogging: true
        })

        this.fastify.register(websocket, {
            options: {
                maxPayload: websocketMaxPayloadSize
            }
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
                // biome-ignore lint/style/useNamingConvention: allow snake case
                rpc_method: request.rpcMethod,
                // biome-ignore lint/style/useNamingConvention: allow snake case
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

        if (websocketEnabled) {
            // biome-ignore lint/suspicious/useAwait: adhere to interface
            this.fastify.register(async (fastify) => {
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
                    // biome-ignore lint/suspicious/useAwait: adhere to interface
                    wsHandler: async (socket: WebSocket.WebSocket, request) => {
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
        this.port = port
        this.registry = registry
        this.metrics = metrics
        this.apiVersions = apiVersions
        this.defaultApiVersion = defaultApiVersion
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
        reply.rpcStatus = "failed" // default to failed
        let requestId: number | null = null

        const versionParsingResult = altoVersions.safeParse(
            (request.params as any)?.version ?? this.defaultApiVersion
        )

        if (!versionParsingResult.success) {
            const error = fromZodError(versionParsingResult.error)
            throw new RpcError(
                `invalid version ${error.message}`,
                ValidationErrors.InvalidFields
            )
        }

        const apiVersion: ApiVersion = versionParsingResult.data

        if (this.apiVersions.indexOf(apiVersion) === -1) {
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
            const result = await this.rpcEndpoint.handleMethod(
                bundlerRequest,
                apiVersion
            )
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
