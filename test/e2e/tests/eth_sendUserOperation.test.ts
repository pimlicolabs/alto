import { test, describe, expect, beforeAll } from "vitest"
import {
    ENTRYPOINT_ADDRESS_V06,
    BundlerClient,
    ENTRYPOINT_ADDRESS_V07
} from "permissionless"
import { getBundlerClient, getSmartAccountClient } from "../src/utils"
import { foundry } from "viem/chains"
import { createTestClient, http, parseEther, parseGwei } from "viem"
import { ANVIL_RPC } from "../src/constants"

const anvilClient = createTestClient({
    chain: foundry,
    mode: "anvil",
    transport: http(ANVIL_RPC)
})

describe.each([
    { entryPoint: ENTRYPOINT_ADDRESS_V06, version: "v0.6" },
    { entryPoint: ENTRYPOINT_ADDRESS_V07, version: "v0.7" }
])("$version supports eth_sendUserOperation", ({ entryPoint }) => {
    let bundlerClient: BundlerClient<typeof entryPoint>

    beforeAll(async () => {
        bundlerClient = getBundlerClient(entryPoint)
    })

    test("Retry when `max fee per gas less than block base fee` occurs", async () => {
        const smartAccountClient = await getSmartAccountClient({
            entryPoint
        })
        const smartAccount = smartAccountClient.account

        await anvilClient.setAutomine(false)
        await anvilClient.mine({ blocks: 1 })

        const to = "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5"
        const value = parseEther("0.15")

        const op = await smartAccountClient.prepareUserOperationRequest({
            userOperation: {
                callData: await smartAccount.encodeCallData({
                    to,
                    value,
                    data: "0x"
                })
            }
        })
        op.signature = await smartAccount.signUserOperation(op)

        const hash = await bundlerClient.sendUserOperation({
            userOperation: op
        })

        await new Promise((resolve) => setTimeout(resolve, 1500))

        // increase next block base fee whilst current tx is in mempool
        await anvilClient.setNextBlockBaseFeePerGas({
            baseFeePerGas: parseGwei("150")
        })

        await anvilClient.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, 1500))

        // check that no tx was mined
        let opReceipt = await bundlerClient.getUserOperationReceipt({
            hash
        })
        expect(opReceipt).toBeNull()

        // new block should trigger alto's mempool to replace the eoa tx with too low gasPrice
        await anvilClient.mine({ blocks: 1 })
        await new Promise((resolve) => setTimeout(resolve, 1500))

        opReceipt = await bundlerClient.getUserOperationReceipt({
            hash
        })

        expect(opReceipt?.success).equal(true)

        await anvilClient.setAutomine(true)
    })
})
