import z from "zod/v4"
import {
    addressSchema,
    hexData32Schema,
    hexDataSchema,
    hexNumberSchema
} from "./common"

const stateOverridesSchema = z.record(
    addressSchema,
    z.object({
        balance: hexNumberSchema.optional(),
        nonce: hexNumberSchema.optional(),
        code: hexDataSchema.optional(),
        state: z.record(hexData32Schema, hexData32Schema).optional(),
        stateDiff: z.record(hexData32Schema, hexData32Schema).optional()
    })
)

type StateOverrides = z.infer<typeof stateOverridesSchema>

export { stateOverridesSchema, type StateOverrides }
