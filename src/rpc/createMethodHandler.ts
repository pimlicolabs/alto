import { z } from "zod"
import type { RpcHandler } from "./rpcHandler"
import { ApiVersion } from "../types/utils"
import { bundlerRpcSchema } from "@alto/types"

export type MethodHandler<T extends z.ZodType = z.ZodType> = {
    schema: T
    method: z.infer<T>["method"]
    handler: (args: {
        rpcHandler: RpcHandler
        params: DeepReadonly<z.infer<T>["params"]>
        apiVersion: ApiVersion
    }) => Promise<z.infer<T>["result"]> | z.infer<T>["result"]
}

export const createMethodHandler = <
    T extends typeof bundlerRpcSchema
>(handler: {
    schema: T
    method: z.infer<T>["method"]
    handler: (args: {
        rpcHandler: RpcHandler
        params: DeepReadonly<z.infer<T>["params"]>
        apiVersion: ApiVersion
    }) => Promise<z.infer<T>["result"]> | z.infer<T>["result"]
}): {
    schema: T
    method: z.infer<T>["method"]
    handler: (args: {
        rpcHandler: RpcHandler
        params: DeepReadonly<z.infer<T>["params"]>
        apiVersion: ApiVersion
    }) => Promise<z.infer<T>["result"]> | z.infer<T>["result"]
} => {
    return {
        schema: handler.schema,
        method: handler.method,
        handler: (args) => {
            const freezeDeep = (
                obj: unknown
            ): DeepReadonly<z.infer<T>["params"]> => {
                if (Array.isArray(obj)) {
                    return Object.freeze(obj.map(freezeDeep)) as DeepReadonly<
                        z.infer<T>["params"]
                    >
                }
                if (obj !== null && typeof obj === "object") {
                    const frozenObj = Object.create(Object.getPrototypeOf(obj))
                    for (const prop of Object.getOwnPropertyNames(obj)) {
                        frozenObj[prop] = freezeDeep(
                            obj[prop as string] as unknown
                        )
                    }
                    return Object.freeze(frozenObj) as DeepReadonly<
                        z.infer<T>["params"]
                    >
                }
                return obj as DeepReadonly<z.infer<T>["params"]>
            }

            const frozenParams = freezeDeep(args.params)

            // Call the handler with frozen params
            return handler.handler({
                rpcHandler: args.rpcHandler,
                params: frozenParams,
                apiVersion: args.apiVersion
            })
        }
    }
}

export type DeepReadonly<T> = {
    readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P]
}
