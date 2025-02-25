import type { z } from "zod"
import type { RpcHandler } from "./rpcHandler"
import { AltoConfig } from "../createConfig"

export interface HandlerMeta {
    method: string
    config: AltoConfig
}

export type MethodHandler<R extends z.ZodType = z.ZodType> = {
    method: string
    schema: z.ZodType
    responseSchema: R
    handler: (args: {
        relay: RpcHandler
        params: any
        meta: HandlerMeta
    }) => Promise<z.infer<R>> | z.infer<R>
}

export const createMethodHandler = <T extends z.ZodType, R extends z.ZodType>(
    handler: Omit<MethodHandler<R>, "handler"> & {
        handler: (args: {
            relay: RpcHandler
            params: z.infer<T>
            meta: HandlerMeta
        }) => Promise<z.infer<R>> | z.infer<R>
        schema: T
        responseSchema: R
    }
): MethodHandler<R> => handler
