import type { z } from "zod"
import type { RpcHandler } from "./rpcHandler"
import type { ApiVersion } from "@alto/types"
import type { ReadonlyDeep } from "type-fest"

export type MethodHandler<T extends z.ZodType = z.ZodType> = {
    schema: T
    method: z.infer<T>["method"]
    handler: (args: {
        rpcHandler: RpcHandler
        params: ReadonlyDeep<z.infer<T>["params"]>
        apiVersion: ApiVersion
    }) => Promise<z.infer<T>["result"]> | z.infer<T>["result"]
}

const freezeDeep = <T>(obj: T): T => {
    if (Array.isArray(obj)) {
        return Object.freeze(obj.map(freezeDeep)) as T
    }
    if (obj !== null && typeof obj === "object") {
        const frozenObj = Object.create(Object.getPrototypeOf(obj))
        for (const prop of Object.getOwnPropertyNames(obj)) {
            const value = obj[prop as keyof T]
            frozenObj[prop] = freezeDeep(value)
        }
        return Object.freeze(frozenObj) as T
    }
    return obj as T
}

export const createMethodHandler = <T extends z.ZodType>(methodConfig: {
    schema: T
    method: z.infer<T>["method"]
    handler: (args: {
        rpcHandler: RpcHandler
        params: ReadonlyDeep<z.infer<T>["params"]>
        apiVersion: ApiVersion
    }) => Promise<z.infer<T>["result"]> | z.infer<T>["result"]
}): {
    schema: T
    method: z.infer<T>["method"]
    handler: (args: {
        rpcHandler: RpcHandler
        params: ReadonlyDeep<z.infer<T>["params"]>
        apiVersion: ApiVersion
    }) => Promise<z.infer<T>["result"]> | z.infer<T>["result"]
} => {
    return {
        schema: methodConfig.schema,
        method: methodConfig.method,
        handler: async (args) => {
            const handlerStartTime = performance.now()
            console.log(`[LATENCY] STEP 5.3.0: Creating frozen params for ${methodConfig.method}`)
            
            const freezeStart = performance.now()
            const frozenParams = freezeDeep(args.params)
            const freezeEnd = performance.now()
            
            console.log(`[LATENCY] STEP 5.3.0.1: Parameter freezing for ${methodConfig.method} took ${freezeEnd - freezeStart}ms`)

            // Call the handler with frozen params
            console.log(`[LATENCY] STEP 5.3.0.2: Calling actual handler for ${methodConfig.method}`)
            const handlerCallStart = performance.now()
            
            const result = await methodConfig.handler({
                rpcHandler: args.rpcHandler,
                params: frozenParams,
                apiVersion: args.apiVersion
            })
            
            const handlerCallEnd = performance.now()
            console.log(`[LATENCY] STEP 5.3.0.3: Actual handler for ${methodConfig.method} took ${handlerCallEnd - handlerCallStart}ms`)
            console.log(`[LATENCY] STEP 5.3.0.4: Total handler wrapper time for ${methodConfig.method}: ${handlerCallEnd - handlerStartTime}ms`)
            
            return result
        }
    }
}
