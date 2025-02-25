import { z } from "zod"
import type { RpcHandler } from "./rpcHandler"
import { ApiVersion } from "@alto/types"

export interface HandlerMeta {
    method: string
    apiVersion: ApiVersion
}

// Define the expected shape of our RPC schemas
export type RpcSchemaType = {
    method: string
    params: any
    result: any
}

// Type for a Zod schema that validates an RPC schema
export type RpcSchema = z.ZodType<RpcSchemaType>

export type MethodHandler<S extends RpcSchema> = {
    schema: S
    handler: (args: {
        relay: RpcHandler
        params: z.infer<S>["params"]
        meta: HandlerMeta
    }) => Promise<z.infer<S>["result"]> | z.infer<S>["result"]
}

export const createMethodHandler = <S extends RpcSchema>(handler: {
    schema: S
    handler: (args: {
        relay: RpcHandler
        params: z.infer<S>["params"]
        meta: HandlerMeta
    }) => Promise<z.infer<S>["result"]> | z.infer<S>["result"]
}): MethodHandler<S> => handler
