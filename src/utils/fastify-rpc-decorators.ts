import type { FastifyPluginCallback, FastifyReply } from "fastify"

declare module "fastify" {
    interface FastifyRequest {
        rpcMethod: string
    }

    interface FastifyReply {
        rpcStatus: RpcStatus
        setRpcStatus(rpcStatus: RpcStatus): FastifyReply
    }
}

export enum RpcStatus {
    Unset = "unset",
    ServerError = "server_error",
    ClientError = "client_error",
    Success = "success"
}

// define plugin using callbacks
const plugin: FastifyPluginCallback = (fastify, _, done) => {
    fastify.decorateRequest("rpcMethod", null)
    fastify.decorateReply("rpcStatus", RpcStatus.Unset)
    fastify.decorateReply(
        "setRpcStatus",
        function (rpcStatus: RpcStatus): FastifyReply {
            this.rpcStatus = rpcStatus
            return this
        }
    )

    done()
}

// Type assertion to allow symbol indexing
;(plugin as any)[Symbol.for("skip-override")] = true

export default plugin
