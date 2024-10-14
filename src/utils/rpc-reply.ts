import type { FastifyReply } from "fastify"
import type * as WebSocket from "ws"

class RpcReply {
    private http: FastifyReply | null
    private websocket: WebSocket.WebSocket | null

    // Used only for HTTP response status code
    private _status: number
    private _rpcStatus: "failed" | "success"

    constructor(
        http: FastifyReply | null,
        websocket: WebSocket.WebSocket | null
    ) {
        this.http = http
        this.websocket = websocket
        this._status = 200
        this._rpcStatus = "failed"
    }

    public status(status: number) {
        this._status = status

        return this
    }

    // biome-ignore lint/suspicious/useAwait:
    public async send(data: any) {
        if (this.http) {
            return this.http.status(this._status).send(data)
        }

        if (this.websocket) {
            return this.websocket.send(JSON.stringify(data))
        }
    }

    static fromHttpReply(reply: FastifyReply) {
        const rpcReply = new RpcReply(reply, null)

        return rpcReply
    }

    static fromSocket(socket: WebSocket.WebSocket) {
        const rpcReply = new RpcReply(null, socket)

        return rpcReply
    }

    set rpcStatus(status: "failed" | "success") {
        this._rpcStatus = status
    }

    get rpcStatus() {
        return this._rpcStatus
    }
}

export default RpcReply
