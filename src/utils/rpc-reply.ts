import type { FastifyReply } from "fastify"
import type * as WebSocket from "ws"
import { RpcStatus } from "./fastify-rpc-decorators"

class RpcReply {
    private reply: FastifyReply | null
    private websocket: WebSocket.WebSocket | null

    constructor(
        reply: FastifyReply | null,
        websocket: WebSocket.WebSocket | null
    ) {
        this.reply = reply
        this.websocket = websocket
    }

    public status(status: number) {
        this.reply?.status(status)

        return this
    }

    // biome-ignore lint/suspicious/useAwait:
    public async send(data: any) {
        if (this.reply) {
            return this.reply.send(data)
        }

        if (this.websocket) {
            return this.websocket.send(JSON.stringify(data))
        }
    }

    public setRpcStatus(status: RpcStatus): RpcReply {
        this.reply?.setRpcStatus(status)

        return this
    }

    static fromHttpReply(reply: FastifyReply) {
        const rpcReply = new RpcReply(reply, null)

        return rpcReply
    }

    static fromSocket(socket: WebSocket.WebSocket) {
        const rpcReply = new RpcReply(null, socket)

        return rpcReply
    }

    get rpcStatus() {
        return this.reply?.rpcStatus ?? RpcStatus.Unset
    }
}

export default RpcReply
