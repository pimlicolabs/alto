/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { JSONRPCResponse, bundlerRequestSchema, jsonRpcSchema } from "@alto/types"
import { RpcError, ValidationErrors } from "@alto/types"
import { fromZodError } from "zod-validation-error"
import { IRpcEndpoint } from "./rpcHandler"
import { IBundlerArgs } from "@alto/config"
import { toHex } from "viem"
import { Logger } from "@alto/utils"
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

// jsonBigIntOverride.ts
const originalJSONStringify = JSON.stringify

JSON.stringify = function (
    value: any,
    replacer?: ((this: any, key: string, value: any) => any) | (string | number)[] | null,
    space?: string | number
): string {
    const bigintReplacer = (key: string, value: any): any => {
        if (typeof value === "bigint") {
            return toHex(value)
        }
        return value
    }

    const wrapperReplacer = (key: string, value: any): any => {
        if (typeof replacer === "function") {
            value = replacer(key, value)
        } else if (Array.isArray(replacer)) {
            if (!replacer.includes(key)) {
                return
            }
        }
        return bigintReplacer(key, value)
    }

    return originalJSONStringify(value, wrapperReplacer, space)
}

export class Server {
    private fastify: FastifyInstance
    private rpcEndpoint: IRpcEndpoint
    private bundlerArgs: IBundlerArgs
    private logger: Logger

    constructor(rpcEndpoint: IRpcEndpoint, bundlerArgs: IBundlerArgs, logger: Logger) {
        this.fastify = Fastify({
            logger
        })

        this.fastify.post("/rpc", this.rpc.bind(this))

        this.rpcEndpoint = rpcEndpoint
        this.bundlerArgs = bundlerArgs

        this.logger = logger
    }

    public async start(): Promise<void> {
        this.fastify.listen({ port: this.bundlerArgs.port }, () => {
            this.logger.info(`Server listening on port ${this.bundlerArgs.port}`)
        })
    }

    public async stop(): Promise<void> {
        // TODO
    }

    public async rpc(request: FastifyRequest, reply: FastifyReply): Promise<void> {
        try {
            const contentTypeHeader = request.headers["content-type"]
            if (contentTypeHeader !== "application/json") {
                throw new RpcError(
                    "invalid content-type, content-type must be application/json",
                    ValidationErrors.InvalidFields
                )
            }
            this.fastify.log.debug(request.body, `received request`)
            const jsonRpcResponse = await this.innerRpc(request.body)
            await reply.status(200).send(jsonRpcResponse)
            this.fastify.log.info(jsonRpcResponse, `sent reply`)
        } catch (err) {
            if (err instanceof RpcError) {
                const rpcError = {
                    message: err.message,
                    data: err.data,
                    code: err.code
                }
                await reply.status(400).send(rpcError)
                this.fastify.log.info(rpcError, `error reply`)
            } else {
                if (err instanceof Error) {
                    await reply.status(500).send(err.message)
                    this.fastify.log.error(err, `error reply (non-rpc)`)
                } else {
                    await reply.status(500).send("Unknown error")
                    this.fastify.log.info(reply.raw, `error reply`)
                }
            }
        }
    }

    public async innerRpc(body: unknown): Promise<JSONRPCResponse> {
        const jsonRpcParsing = jsonRpcSchema.safeParse(body)
        if (!jsonRpcParsing.success) {
            const validationError = fromZodError(jsonRpcParsing.error)
            throw new RpcError(`invalid JSON-RPC request ${validationError.message}`, ValidationErrors.InvalidFields)
        }

        const jsonRpcRequest = jsonRpcParsing.data

        const bundlerRequestParsing = bundlerRequestSchema.safeParse(jsonRpcRequest)
        if (!bundlerRequestParsing.success) {
            const validationError = fromZodError(bundlerRequestParsing.error)
            throw new RpcError(validationError.message, ValidationErrors.InvalidFields)
        }

        const bundlerRequest = bundlerRequestParsing.data
        this.fastify.log.info(bundlerRequest, `received request ${bundlerRequest.method}`)
        const result = await this.rpcEndpoint.handleMethod(bundlerRequest)

        const jsonRpcResponse: JSONRPCResponse = {
            jsonrpc: "2.0",
            id: jsonRpcRequest.id,
            result: result.result
        }

        return jsonRpcResponse
    }
}
