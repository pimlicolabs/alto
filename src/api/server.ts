/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import express, { Express, Response, Request } from "express"
import cors from "cors"
import { JSONRPCResponse, bundlerRequestSchema, jsonRpcSchema } from "./schemas"
import { RpcError, ValidationErrors } from "../utils"
import { fromZodError } from "zod-validation-error"
import { RpcHandler } from "./rpcHandler"

export class Server {
    private app: Express
    private rpcHandler: RpcHandler

    constructor() {
        this.app = express()
        this.app.use(cors())
        this.app.use(express.json())

        this.app.post("/rpc", this.rpc.bind(this))

        this.rpcHandler = new RpcHandler()
    }

    public async start(): Promise<void> {
        this.app.listen(3000, () => {
            console.log("Server listening on port 3000")
        })
    }

    public async stop(): Promise<void> {
        // TODO
    }

    public async rpc(req: Request, res: Response): Promise<void> {
        try {
            const jsonRpcResponse = await this.innerRpc(req, res)
            res.status(200).send(jsonRpcResponse)
        } catch (err) {
            if (err instanceof RpcError) {
                res.status(400).send({
                    message: err.message,
                    data: err.data,
                    code: err.code,
                })
            } else {
                if (err instanceof Error) {
                    res.status(500).send(err.message)
                } else {
                    res.status(500).send("Unknown error")
                }
            }
        }
    }

    public async innerRpc(req: Request, res: Response): Promise<JSONRPCResponse> {
        console.log(req.body)
        const jsonRpcParsing = jsonRpcSchema.safeParse(req.body)
        if (!jsonRpcParsing.success) {
            throw new RpcError("Invalid JSON-RPC request", ValidationErrors.InvalidFields)
        }

        const jsonRpcRequest = jsonRpcParsing.data

        const bundlerRequestParsing = bundlerRequestSchema.safeParse(jsonRpcRequest)
        if (!bundlerRequestParsing.success) {
            const validationError = fromZodError(bundlerRequestParsing.error)
            throw new RpcError(validationError.message, ValidationErrors.InvalidFields)
        }

        const bundlerRequest = bundlerRequestParsing.data
        const result = await this.rpcHandler.handleMethod(bundlerRequest)

        const jsonRpcResponse: JSONRPCResponse = {
            jsonrpc: "2.0",
            id: jsonRpcRequest.id,
            result: result.result,
        }

        return jsonRpcResponse
    }
}
