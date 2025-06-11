import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify"
import type { JsonRpcRequest } from "@alto/types"

export interface ApiKeyAuthConfig {
    apiKey: string
    protectedMethods: string[]
}

export const createApiKeyAuthMiddleware = (config: ApiKeyAuthConfig) => {
    return async (
        request: FastifyRequest,
        reply: FastifyReply,
        done: HookHandlerDoneFunction
    ) => {
        // Skip auth for non-RPC endpoints
        if (!["/rpc", "/", "/v1/rpc", "/v2/rpc"].includes(request.url) && !request.url.match(/^\/v\d+\/rpc$/)) {
            return done()
        }

        // Parse the request body to get the RPC method
        const body = request.body as JsonRpcRequest | JsonRpcRequest[]
        if (!body) {
            return done()
        }

        // Extract the RPC method(s)
        const methods = Array.isArray(body) 
            ? body.map(req => req.method)
            : [body.method]

        // Check if any of the methods require authentication
        const requiresAuth = methods.some(method => 
            config.protectedMethods.includes(method)
        )

        if (!requiresAuth) {
            return done()
        }

        // Check API key
        const providedKey = request.headers["x-api-key"] as string

        if (!providedKey || providedKey !== config.apiKey) {
            reply.code(401).send({
                jsonrpc: "2.0",
                id: null,
                error: {
                    code: -32001,
                    message: "Unauthorized: Invalid or missing API key"
                }
            })
            return
        }

        done()
    }
}