import { test, describe, expect, beforeAll, beforeEach } from "vitest"
import {
    ENTRYPOINT_ADDRESS_V06,
    BundlerClient,
    ENTRYPOINT_ADDRESS_V07,
    EstimateUserOperationGasError
} from "permissionless"
import {
    beforeEachCleanUp,
    getBundlerClient,
    getSmartAccountClient
} from "../src/utils"

describe.each([
    { entryPoint: ENTRYPOINT_ADDRESS_V06, version: "v0.6" },
    { entryPoint: ENTRYPOINT_ADDRESS_V07, version: "v0.7" }
])("$version supports eth_estimateUserOperationGas", ({ entryPoint }) => {
    let bundlerClient: BundlerClient<typeof entryPoint>

    beforeAll(async () => {
        bundlerClient = getBundlerClient(entryPoint)
    })

    beforeEach(async () => {
        await beforeEachCleanUp()
    })

    test("Can estimate with empty gasLimit values", async () => {
        const smartAccountClient = await getSmartAccountClient({
            entryPoint
        })

        let op = await smartAccountClient.prepareUserOperationRequest({
            userOperation: {
                callData: await smartAccountClient.account.encodeCallData({
                    to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                    data: "0x",
                    value: 0n
                })
            }
        })
        op = {
            ...op,
            callGasLimit: 0n,
            verificationGasLimit: 0n,
            preVerificationGas: 0n
        }

        const gasParams = await bundlerClient.estimateUserOperationGas({
            // @ts-ignore
            userOperation: op
        })

        expect(gasParams.verificationGasLimit).not.toBeNull()
        expect(gasParams.preVerificationGas).not.toBeNull()
        expect(gasParams.callGasLimit).not.toBeNull()
    })

    test("Throws if gasPrices are set to zero", async () => {
        const smartAccountClient = await getSmartAccountClient({
            entryPoint
        })

        let op = await smartAccountClient.prepareUserOperationRequest({
            userOperation: {
                callData: await smartAccountClient.account.encodeCallData({
                    to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                    data: "0x",
                    value: 0n
                })
            }
        })
        op = {
            ...op,
            maxFeePerGas: 0n,
            maxPriorityFeePerGas: 0n
        }

        await expect(async () =>
            bundlerClient.estimateUserOperationGas({
                // @ts-ignore
                userOperation: op
            })
        ).rejects.toThrow(EstimateUserOperationGasError)
    })
})
