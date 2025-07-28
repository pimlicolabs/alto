import { hexData32Schema, userOperationSchema } from "@pimlico/schemas"
import z from "zod/v4"

const referencedCodeHashesSchema = z.object({
    addresses: z.array(z.string()),
    hash: z.string()
})

const userOpInfoSchema = z.object({
    userOp: userOperationSchema,
    // === userOp Details ===
    userOpHash: hexData32Schema,
    addedToMempool: z.number(), // timestamp when the bundling process begins (when it leaves outstanding mempool)
    referencedContracts: referencedCodeHashesSchema.optional(),
    submissionAttempts: z.number()
})

type ReferencedCodeHashes = z.infer<typeof referencedCodeHashesSchema>
type UserOpInfo = z.infer<typeof userOpInfoSchema>

export {
    userOpInfoSchema,
    referencedCodeHashesSchema,
    type ReferencedCodeHashes,
    type UserOpInfo
}
