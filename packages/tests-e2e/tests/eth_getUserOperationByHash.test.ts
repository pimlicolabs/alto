import { test, describe, expect, beforeAll, beforeEach } from "vitest"
import { ENTRYPOINT_ADDRESS_V06, BundlerClient } from "permissionless"
import {
    beforeEachCleanUp,
    getBundlerClient,
    getSmartAccountClient
} from "../src/utils"
import { Hex, createTestClient, http } from "viem"
import { foundry } from "viem/chains"
import { ANVIL_RPC } from "../src/constants"

const anvilClient = createTestClient({
    chain: foundry,
    mode: "anvil",
    transport: http(ANVIL_RPC)
})

describe.each([
    { entryPoint: ENTRYPOINT_ADDRESS_V06, version: "v0.6" }
    //{ entryPoint: ENTRYPOINT_ADDRESS_V07, version: "v0.7" }
])("$version supports eth_getUserOperationByHash", ({ entryPoint }) => {
    let bundlerClient: BundlerClient<typeof entryPoint>

    beforeAll(async () => {
        bundlerClient = getBundlerClient(entryPoint)
    })

    beforeEach(async () => {
        await beforeEachCleanUp()
    })

    test("Return null if hash not found", async () => {
        const hash =
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        const response = await bundlerClient.getUserOperationByHash({ hash })

        expect(response).toBeNull()
    })

    test("Pending UserOperation should return null", async () => {
        const smartAccountClient = await getSmartAccountClient({
            entryPoint
        })
        const smartAccount = smartAccountClient.account

        await anvilClient.setAutomine(false)
        await anvilClient.mine({ blocks: 1 })

        const op = await smartAccountClient.prepareUserOperationRequest({
            userOperation: {
                callData: await smartAccountClient.account.encodeCallData({
                    to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                    data: "0x",
                    value: 0n
                })
            }
        })
        op.signature = await smartAccount.signUserOperation(op)

        const hash = await bundlerClient.sendUserOperation({
            userOperation: op
        })

        await new Promise((resolve) => setTimeout(resolve, 1500))

        // check that no tx was mined
        let opReceipt = await bundlerClient.getUserOperationByHash({
            hash
        })
        expect(opReceipt).toBeNull()

        await anvilClient.setAutomine(true)
    })

    test("Return userOperation, entryPoint, blockNum, blockHash, txHash for mined tx", async () => {
        const smartAccountClient = await getSmartAccountClient({
            entryPoint
        })
        const smartAccount = smartAccountClient.account

        let op = await smartAccountClient.prepareUserOperationRequest({
            userOperation: {
                callData: await smartAccountClient.account.encodeCallData({
                    to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                    data: "0x",
                    value: 0n
                })
            }
        })
        op.signature = await smartAccount.signUserOperation(op)

        const hash = await bundlerClient.sendUserOperation({
            userOperation: op
        })

        await new Promise((resolve) => setTimeout(resolve, 1500))

        const response = await bundlerClient.getUserOperationByHash({ hash })

        expect(response).not.toBeNull()
        expect(response?.entryPoint).toBe(entryPoint)
        expect(response?.blockHash).not.toBeUndefined()
        expect(response?.transactionHash).not.toBeUndefined()

        op.initCode = op.initCode.toLowerCase() as Hex
        expect(response?.userOperation).toEqual(op)
    })
})
