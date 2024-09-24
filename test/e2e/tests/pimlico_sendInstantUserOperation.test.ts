import { describe, test, beforeEach, expect } from "vitest"
import { beforeEachCleanUp, getSmartAccountClient } from "../src/utils"
import {
    entryPoint07Address,
    UserOperationExpiredError,
    type EntryPointVersion,
    type UserOperation,
    UserOperationReceipt
} from "viem/account-abstraction"
import { createClient, http, parseEther } from "viem"
import { deepHexlify } from "permissionless"
import { ALTO_RPC } from "../src/constants"

describe.each([
    //{
    //    entryPoint: entryPoint06Address,
    //    entryPointVersion: "0.6" as EntryPointVersion
    //},
    {
        entryPoint: entryPoint07Address,
        entryPointVersion: "0.7" as EntryPointVersion
    }
])(
    "$entryPointVersion supports pimlico_sendInstantUserOperation",
    ({ entryPoint, entryPointVersion }) => {
        beforeEach(async () => {
            await beforeEachCleanUp()
        })

        test("Send instant userOperation", async () => {
            const smartAccountClient = await getSmartAccountClient({
                entryPointVersion
            })

            const op = (await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: "0x0000000000000000000000000000000000000000",
                        value: parseEther("0.15"),
                        data: "0x"
                    }
                ]
            })) as UserOperation<typeof entryPointVersion>
            op.signature =
                await smartAccountClient.account.signUserOperation(op)

            const bundlerClient = createClient({
                transport: http(ALTO_RPC)
            })

            const receipt = (await bundlerClient.request({
                // @ts-ignore
                method: "pimlico_sendInstantUserOperation",
                params: [deepHexlify(op), entryPoint]
            })) as UserOperationReceipt

            expect(receipt).not.toBeNull()
            expect(receipt?.success).toEqual(true)
        })
    }
)
