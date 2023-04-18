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
import { IRpcEndpoint } from "./rpcHandler"
import { IBundlerArgs } from "../cli/options"

export class Server {
    private app: Express
    private rpcEndpoint: IRpcEndpoint
    private bundlerArgs: IBundlerArgs

    constructor(rpcEndpoint: IRpcEndpoint, bundlerArgs: IBundlerArgs) {
        this.app = express()
        this.app.use(cors())
        this.app.use(express.json())

        this.app.post("/rpc", this.rpc.bind(this))

        this.rpcEndpoint = rpcEndpoint
        this.bundlerArgs = bundlerArgs
    }

    public async start(): Promise<void> {
        this.app.listen(this.bundlerArgs.port, () => {
            console.log(`Server listening on port ${this.bundlerArgs.port}`)
        })
    }

    public async stop(): Promise<void> {
        // TODO
    }

    public async rpc(req: Request, res: Response): Promise<void> {
        try {
            const contentTypeHeader = req.headers["content-type"]
            if (contentTypeHeader !== "application/json") {
                throw new RpcError(
                    "invalid content-type, content-type must be application/json",
                    ValidationErrors.InvalidFields
                )
            }
            const jsonRpcResponse = await this.innerRpc(req.body)
            res.status(200).send(jsonRpcResponse)
        } catch (err) {
            if (err instanceof RpcError) {
                res.status(400).send({
                    message: err.message,
                    data: err.data,
                    code: err.code
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
        const result = await this.rpcEndpoint.handleMethod(bundlerRequest)

        const jsonRpcResponse: JSONRPCResponse = {
            jsonrpc: "2.0",
            id: jsonRpcRequest.id,
            result: result.result
        }

        return jsonRpcResponse
    }
}
