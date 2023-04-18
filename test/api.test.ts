import { type ChildProcess } from "child_process"
import { createPublicClient, http, PublicClient, toHex } from "viem"
import { foundry } from "viem/chains"
import { launchAnvil } from "./utils"
import { expect } from "earl"
import { RpcHandler } from "../src/api/rpcHandler"

describe("api", () => {
    let client: PublicClient
    let anvilProcess: ChildProcess

    before(async function () {
        // destructure the return value
        anvilProcess = await launchAnvil()
        client = createPublicClient({ transport: http(), chain: foundry })
    })

    after(function () {
        anvilProcess.kill()
    })

    describe("rpcHandler", () => {
        it("eth_chainId", async function () {
            const anvilChainId = await client.getChainId()
            const handler = new RpcHandler()
            const chainId = await handler.eth_chainId([])

            expect(chainId).toEqual(toHex(anvilChainId))
        })
    })
})
