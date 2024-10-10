import type { PimlicoClient } from "permissionless/clients/pimlico"
import { http, createPublicClient } from "viem"
import type { EntryPointVersion } from "viem/account-abstraction"
import { foundry } from "viem/chains"
import { beforeAll, beforeEach, describe, expect, test } from "vitest"
import { ANVIL_RPC } from "../src/constants"
import { beforeEachCleanUp, getPimlicoClient } from "../src/utils"

const publicClient = createPublicClient({
    transport: http(ANVIL_RPC),
    chain: foundry
})

describe.each([
    { entryPointVersion: "0.6" as EntryPointVersion },
    { entryPointVersion: "0.7" as EntryPointVersion }
])(
    "$entryPointVersion supports eth_sendUserOperation",
    ({ entryPointVersion }) => {
        let pimlicoBundlerClient: PimlicoClient

        beforeAll(() => {
            pimlicoBundlerClient = getPimlicoClient({ entryPointVersion })
        })

        beforeEach(async () => {
            await beforeEachCleanUp()
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
