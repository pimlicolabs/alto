import { z } from "zod/v4"
import { hexData32Schema } from "./common"

const opEventType = z.union([
    z.object({
        eventType: z.literal("received")
    }),
    z.object({
        eventType: z.literal("added_to_mempool")
    }),
    z.object({
        eventType: z.literal("queued")
    }),
    z.object({
        eventType: z.literal("failed_validation"),
        data: z.object({
            reason: z.string().optional(),
            aaError: z.string().optional()
        })
    }),
    z.object({
        eventType: z.literal("dropped"),
        data: z.object({
            reason: z.string().optional(),
            aaError: z.string().optional()
        })
    }),
    z.object({
        eventType: z.literal("submitted"),
        transactionHash: hexData32Schema
    }),
    z.object({
        eventType: z.literal("included_onchain"),
        transactionHash: hexData32Schema,
        data: z.object({
            blockNumber: z.number()
        })
    }),
    z.object({
        eventType: z.literal("frontran_onchain"),
        transactionHash: hexData32Schema,
        data: z.object({
            blockNumber: z.number()
        })
    }),
    z.object({
        eventType: z.literal("failed_onchain"),
        transactionHash: hexData32Schema,
        data: z.object({
            blockNumber: z.number(),
            reason: z.string().optional(),
            aaError: z.string().optional()
        })
    }),
    z.object({
        eventType: z.literal("execution_reverted_onchain"),
        transactionHash: hexData32Schema,
        data: z.object({
            blockNumber: z.number(),
            reason: z.string().optional()
        })
    })
])

type OpEventType = z.infer<typeof opEventType>

export { opEventType, type OpEventType }
