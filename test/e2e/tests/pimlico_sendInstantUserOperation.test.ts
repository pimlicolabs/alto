import { describe, test, beforeEach } from "vitest"
import { beforeEachCleanUp, getSmartAccountClient } from "../src/utils"
import {
    entryPoint06Address,
    entryPoint07Address,
    type EntryPointVersion,
    type UserOperation
} from "viem/account-abstraction"
import { parseEther } from "viem"
import { deepHexlify } from "permissionless"

describe.each([
    {
        entryPoint: entryPoint06Address,
        entryPointVersion: "0.6" as EntryPointVersion
    },
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

            const receipt = await smartAccountClient.request({
                // @ts-ignore
                method: "pimlico_sendInstantUserOperation",
                // @ts-ignore
                params: [deepHexlify(op), entryPoint]
            })

            console.log(receipt)
        })
    }
)
