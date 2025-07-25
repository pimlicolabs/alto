import z from "zod/v4"
import { addressSchema } from "./common"

const paymasterContextSchema = z.union([
    z.object({
        token: addressSchema,
        validForSeconds: z.number().optional()
    }),
    z.object({
        sponsorshipPolicyId: z.string().optional(),
        validForSeconds: z.number().optional(),
        meta: z.record(z.string(), z.string()).optional()
    }),
    z.null()
])

type PaymasterContext = z.infer<typeof paymasterContextSchema>

export { paymasterContextSchema, type PaymasterContext }
