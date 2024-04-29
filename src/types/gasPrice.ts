// {"safeLow":{"maxPriorityFee":32.70666665266667,"maxFee":32.70666666866667},"standard":{"maxPriorityFee":33.10666665266667,"maxFee":33.10666666866667},"fast":{"maxPriorityFee":34.54799998386667,"maxFee":34.54799999986667},"estimatedBaseFee":1.6e-8,"blockTime":2,"blockNumber":36422482}

// {
//     "safeLow": {
//       "maxPriorityFee": 10.474218399333333,
//       "maxFee": 10.474218415333333
//     },
//     "standard": {
//       "maxPriorityFee": 10.674218398266666,
//       "maxFee": 10.674218414266665
//     },
//     "fast": {
//       "maxPriorityFee": 15.771550529,
//       "maxFee": 15.771550545
//     },
//     "estimatedBaseFee": 1.6e-08,
//     "blockTime": 2,
//     "blockNumber": 36422513
//   }

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
