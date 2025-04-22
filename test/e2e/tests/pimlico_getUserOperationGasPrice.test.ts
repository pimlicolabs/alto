import type { PimlicoClient } from "permissionless/clients/pimlico"
import { http, createPublicClient } from "viem"
import { foundry } from "viem/chains"
import { beforeAll, beforeEach, describe, expect, inject, test } from "vitest"
import { beforeEachCleanUp, getPimlicoClient } from "../src/utils/index.js"
import { EntryPointVersion } from "../src/constants.js"

describe.each([
    { entryPointVersion: "0.6" as EntryPointVersion },
    { entryPointVersion: "0.7" as EntryPointVersion },
    { entryPointVersion: "0.8" as EntryPointVersion }
])(
    "$entryPointVersion supports eth_sendUserOperation",
    ({ entryPointVersion }) => {
        let pimlicoBundlerClient: PimlicoClient
        const anvilRpc = inject("anvilRpc")
        const altoRpc = inject("altoRpc")

        const publicClient = createPublicClient({
            transport: http(anvilRpc),
            chain: foundry
        })

        beforeAll(() => {
            pimlicoBundlerClient = getPimlicoClient({
                entryPointVersion,
                altoRpc
            })
        })

        beforeEach(async () => {
            await beforeEachCleanUp({ anvilRpc, altoRpc })
        })

        test("Get gasPrice", async () => {
            const networkPrices = await publicClient.estimateFeesPerGas()
            const gasPrice =
                await pimlicoBundlerClient.getUserOperationGasPrice()

            const slow = gasPrice.slow
            const standard = gasPrice.standard
            const fast = gasPrice.fast

            expect(slow.maxFeePerGas).toBeGreaterThan(0)
            expect(slow.maxPriorityFeePerGas).toBeGreaterThan(0)
            expect(standard.maxFeePerGas).toBeGreaterThan(0)
            expect(standard.maxPriorityFeePerGas).toBeGreaterThan(0)
            expect(fast.maxFeePerGas).toBeGreaterThan(0)
            expect(fast.maxPriorityFeePerGas).toBeGreaterThan(0)

            expect(
                slow.maxFeePerGas === standard.maxFeePerGas &&
                    standard.maxFeePerGas === fast.maxFeePerGas
            )
            expect(
                slow.maxPriorityFeePerGas === standard.maxPriorityFeePerGas &&
                    standard.maxPriorityFeePerGas === fast.maxPriorityFeePerGas
            )
            expect(networkPrices.maxFeePerGas).toBeLessThanOrEqual(
                slow.maxFeePerGas
            )
            expect(networkPrices.maxPriorityFeePerGas).toBeLessThanOrEqual(
                slow.maxPriorityFeePerGas
            )
            expect(networkPrices.maxFeePerGas).toBeLessThanOrEqual(
                standard.maxFeePerGas
            )
            expect(networkPrices.maxPriorityFeePerGas).toBeLessThanOrEqual(
                standard.maxPriorityFeePerGas
            )
            expect(networkPrices.maxFeePerGas).toBeLessThanOrEqual(
                fast.maxFeePerGas
            )
            expect(networkPrices.maxPriorityFeePerGas).toBeLessThanOrEqual(
                fast.maxPriorityFeePerGas
            )
        })
    }
)
