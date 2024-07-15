import { test, describe, expect, beforeAll, beforeEach } from "vitest"
import { ENTRYPOINT_ADDRESS_V06, ENTRYPOINT_ADDRESS_V07 } from "permissionless"
import { beforeEachCleanUp, getPimlicoBundlerClient } from "../src/utils"
import { foundry } from "viem/chains"
import { createPublicClient, http } from "viem"
import { ANVIL_RPC } from "../src/constants"
import { PimlicoBundlerClient } from "permissionless/clients/pimlico"

const publicClient = createPublicClient({
    transport: http(ANVIL_RPC),
    chain: foundry
})

describe.each([
    { entryPoint: ENTRYPOINT_ADDRESS_V06, version: "v0.6" },
    { entryPoint: ENTRYPOINT_ADDRESS_V07, version: "v0.7" }
])("$version supports eth_sendUserOperation", ({ entryPoint }) => {
    let pimlicoBundlerClient: PimlicoBundlerClient<typeof entryPoint>

    beforeAll(async () => {
        pimlicoBundlerClient = getPimlicoBundlerClient(entryPoint)
    })

    beforeEach(async () => {
        await beforeEachCleanUp()
    })

    test("Get gasPrice", async () => {
        const networkPrices = await publicClient.estimateFeesPerGas()
        const gasPrice = await pimlicoBundlerClient.getUserOperationGasPrice()

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
})
