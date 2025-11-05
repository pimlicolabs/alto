import { parseGwei } from "viem"
import { bigint, z } from "zod"

const gasPrice = z
    .object({
        // @ts-ignore
        maxFee: z
            .union([z.number(), z.string()])
            .transform((val) => parseGwei(`${val}`)),
        // @ts-ignore
        maxPriorityFee: z
            .union([z.number(), z.string()])
            .transform((val) => parseGwei(`${val}`))
    })
    .transform((val) => {
        return {
            maxFeePerGas: val.maxFee,
            maxPriorityFeePerGas: val.maxPriorityFee
        }
    })

export const gasStationResult = z.object({
    safeLow: gasPrice,
    standard: gasPrice,
    fast: gasPrice
    // @ts-ignore
    // estimatedBaseFee: z.union([z.number(), z.string()]).transform((val) => parseGwei(`${val}`)),
    // blockTime: z.number(),
    // blockNumber: z.number()
})

export const gasPriceMultipliers = z.object({
    slow: bigint(),
    standard: bigint(),
    fast: bigint()
})

export type GasPriceMultipliers = z.infer<typeof gasPriceMultipliers>
export type GasPriceParameters = z.infer<typeof gasPrice>
