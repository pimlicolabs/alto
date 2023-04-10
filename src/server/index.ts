import http, { IncomingMessage, ServerResponse } from "http"
import { Validator } from "../validator"
import { Mempool } from "../mempool"

interface JSONRPCRequest {
    jsonrpc: string
    id: number
    method: string
    params: any[]
}

interface JSONRPCResponse {
    jsonrpc: string
    id: number
    result?: any
    error?: any
}

class BundlerError extends Error {
    code: number
    data: any
    constructor(message: string, code: number, data: any) {
        super(message)
        this.code = code
        this.data = data
    }
}

function parseJSONRPCRequest(data: string): JSONRPCRequest {
    try {
        return JSON.parse(data)
    } catch (e: any) {
        throw new Error(`Invalid JSON: ${e.message}`)
    }
}

export class AltoBundler {
    server: http.Server
    constructor(readonly port: number, readonly validator: Validator, readonly mempool: Mempool) {
        this.server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
            let data = ""
            req.on("data", (chunk) => {
                data += chunk.toString()
            })

            req.on("end", async () => {
                try {
                    const request: JSONRPCRequest = parseJSONRPCRequest(data)
                    const response: JSONRPCResponse = await this.executeRequest(request)
                    res.writeHead(200, { "Content-Type": "application/json" })
                    res.end(JSON.stringify(response))
                } catch (e: any) {
                    res.writeHead(500, { "Content-Type": "application/json" })
                    res.end(JSON.stringify({ error: e.message }))
                }
            })
        })
    }

    start() {
        this.server.listen(this.port, () => {
            console.log(`JSON-RPC server listening on port ${this.port}`)
        })
    }

    stop() {
        this.server.close(() => {
            console.log(`JSON-RPC server stopping`)
        })
    }

    async executeRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
        try {
            switch (request.method) {
                case "eth_sendUserOperation":
                    this.validator.validate(request.params[1], request.params[0])
                    const hash = this.mempool.add(request.params[1], request.params[0])
                    return {
                        jsonrpc: "2.0",
                        id: request.id,
                        result: hash,
                    }
                case "eth_estimateUserOperationGas":
                    const estimateResult = this.validator.estimateGas(request.params[1], request.params[0])
                    return {
                        jsonrpc: "2.0",
                        id: request.id,
                        result: estimateResult,
                    }
                case "eth_getUserOperationByHash":
                    const userOp = this.mempool.get(request.params[0])
                    return {
                        jsonrpc: "2.0",
                        id: request.id,
                        result: userOp.included ? userOp : null,
                    }
                default:
                    throw new Error(`Unknown method: ${request.method}`)
            }
        } catch (e: any) {
            if (e instanceof BundlerError) {
                return {
                    jsonrpc: "2.0",
                    id: request.id,
                    error: {
                        message: e.message,
                        code: e.code,
                        data: e.data,
                    },
                }
            } else {
                return {
                    jsonrpc: "2.0",
                    id: request.id,
                    error: {
                        message: e.message,
                        code: -32000,
                    },
                }
            }
        }
    }
}
