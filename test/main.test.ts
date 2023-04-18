import { exec, type ChildProcess } from "child_process"
import { createPublicClient, createTestClient, http, PublicClient, TestClient } from "viem"
import { foundry } from "viem/chains"
import { launchAnvil } from "./utils"
import { expect } from "earl"

describe("test", () => {
    let client: PublicClient
    let anvilProcess: ChildProcess

    before(async function () {
        // destructure the return value
        anvilProcess = await launchAnvil()
        console.log("done")
        client = createPublicClient({ transport: http(), chain: foundry })
    })

    after(function () {
        anvilProcess.kill()
    })

    it("test", async function () {
        const chainId = await client.getChainId()
        expect(chainId).toBeA(Number)
    })

    it("test2", async function () {
        const chainId = await client.getChainId()
    })
})
