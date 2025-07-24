import type { ApiVersion } from "@alto/types"
import type { ReadonlyDeep } from "type-fest"
import type { z } from "zod/v4"
import type { RpcHandler } from "./rpcHandler"

// Define the constraint for the schema type
type MethodSchema = z.ZodObject<{
    method: z.ZodLiteral<string> | z.ZodString
    params: z.ZodType
    result: z.ZodType
}>

export type MethodHandler<T extends MethodSchema = MethodSchema> = {
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

export const createMethodHandler = <T extends MethodSchema>(methodConfig: {
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
        params: unknown
        apiVersion: ApiVersion
    }) => Promise<z.infer<T>["result"]> | z.infer<T>["result"]
} => {
    return {
        schema: methodConfig.schema,
        method: methodConfig.method,
        handler: (args) => {
            // Parse and validate the full request to get typed params
            const validatedRequest = methodConfig.schema.parse({
                method: methodConfig.method,
                params: args.params,
                result: undefined // This is just for validation structure
            })
            
            const frozenParams = freezeDeep(validatedRequest.params)

            // Call the handler with properly typed and frozen params
            return methodConfig.handler({
                rpcHandler: args.rpcHandler,
                params: frozenParams as ReadonlyDeep<z.infer<T>["params"]>,
                apiVersion: args.apiVersion
            })
        }
    }
}
