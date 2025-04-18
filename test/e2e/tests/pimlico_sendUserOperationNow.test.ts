import { deepHexlify } from "permissionless"
import { http, createClient, parseEther } from "viem"
import {
    type UserOperation,
    type UserOperationReceipt,
    entryPoint06Address,
    entryPoint07Address
} from "viem/account-abstraction"
import { beforeEach, describe, expect, inject, test } from "vitest"
import { beforeEachCleanUp, getSmartAccountClient } from "../src/utils/index.js"
import {
    type EntryPointVersion,
    entryPoint08Address
} from "../src/constants.js"

describe.each([
    {
        entryPoint: entryPoint06Address,
        entryPointVersion: "0.6" as EntryPointVersion
    },
    {
        entryPoint: entryPoint07Address,
        entryPointVersion: "0.7" as EntryPointVersion
    },
    {
        entryPoint: entryPoint08Address,
        entryPointVersion: "0.8" as EntryPointVersion
    }
])(
    "$entryPointVersion supports pimlico_sendUserOperationNow",
    ({ entryPoint, entryPointVersion }) => {
        const anvilRpc = inject("anvilRpc")
        const altoRpc = inject("altoRpc")

        beforeEach(async () => {
            await beforeEachCleanUp({ anvilRpc, altoRpc })
        })

        test("Send instant userOperation", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const op = (await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: "0x0000000000000000000000000000000000000000",
                        value: parseEther("0.15"),
                        data: "0x"
                    }
                ]
            })) as UserOperation
            op.signature =
                await smartAccountClient.account.signUserOperation(op)

            const bundlerClient = createClient({
                transport: http(altoRpc)
            })

            const receipt = (await bundlerClient.request({
                // @ts-ignore
                method: "pimlico_sendUserOperationNow",
                params: [deepHexlify(op), entryPoint]
            })) as UserOperationReceipt

            expect(receipt).not.toBeNull()
            expect(receipt?.success).toEqual(true)
        })
    }
)
