import { test, describe, expect, beforeAll, beforeEach } from "vitest"
import {
    ENTRYPOINT_ADDRESS_V06,
    BundlerClient,
    ENTRYPOINT_ADDRESS_V07
} from "permissionless"
import {
    beforeEachCleanUp,
    getBundlerClient,
    getSmartAccountClient
} from "../src/utils"
import { Address, Hex } from "viem"
import {
    deployRevertingContract,
    decodeRevert,
    getRevertCall
} from "../src/revertingContract"
import { deployPaymaster } from "../src/testPaymaster"

describe.each([
    { entryPoint: ENTRYPOINT_ADDRESS_V06, version: "v0.6" },
    { entryPoint: ENTRYPOINT_ADDRESS_V07, version: "v0.7" }
])("$version supports eth_getUserOperationReceipt", ({ entryPoint }) => {
    let bundlerClient: BundlerClient<typeof entryPoint>
    let revertingContract: Address
    let paymaster: Address

    beforeAll(async () => {
        revertingContract = await deployRevertingContract()
        paymaster = await deployPaymaster(entryPoint)
        bundlerClient = getBundlerClient(entryPoint)
    })

    beforeEach(async () => {
        await beforeEachCleanUp()
    })

    test("Returns revert bytes when UserOperation reverts", async () => {
        const smartAccountClient = await getSmartAccountClient({
            entryPoint
        })
        const smartAccount = smartAccountClient.account

        let op = await smartAccountClient.prepareUserOperationRequest({
            userOperation: {
                callData: "0x"
            }
        })
        op = {
            ...op,
            callData: await smartAccountClient.account.encodeCallData({
                to: revertingContract,
                data: getRevertCall("foobar"),
                value: 0n
            }),
            callGasLimit: 500_000n
        }
        op.signature = await smartAccount.signUserOperation(op)

        const hash = await bundlerClient.sendUserOperation({
            userOperation: op
        })

        await new Promise((resolve) => setTimeout(resolve, 1500))

        const receipt = await bundlerClient.getUserOperationReceipt({ hash })

        expect(receipt).not.toBeNull()
        expect(receipt?.success).toEqual(false)
        expect(decodeRevert(receipt?.reason as Hex)).toEqual("foobar")
    })

    test("Returns paymaster when one is used", async () => {
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
        if (entryPoint === ENTRYPOINT_ADDRESS_V06) {
            op.paymasterAndData = paymaster
        } else {
            op.paymaster = paymaster
            op.paymasterVerificationGasLimit = 1_500_000n
            op.paymasterPostOpGasLimit = 500_000n
        }
        op.signature = await smartAccount.signUserOperation(op)

        const hash = await bundlerClient.sendUserOperation({
            userOperation: op
        })

        await new Promise((resolve) => setTimeout(resolve, 1500))

        const receipt = await bundlerClient.getUserOperationReceipt({ hash })

        expect(receipt).not.toBeNull()
        expect(receipt?.success).toEqual(true)
        expect(receipt?.reason).toBeUndefined()
        expect(receipt?.paymaster).toEqual(paymaster)
    })
})
