import { PublicClient, TestClient, createPublicClient, createTestClient, http } from "viem"
import { type ChildProcess } from "child_process"
import { launchAnvil } from "./utils"
import { foundry } from "viem/chains"
import { debug_traceCall } from "../src/tracer"

describe("tracer", () => {
    let client: PublicClient
    let testClient: TestClient
    let anvilProcess: ChildProcess

    before(async function () {
        // destructure the return value
        anvilProcess = await launchAnvil()
        client = createPublicClient({ transport: http(), chain: foundry })
        testClient = createTestClient({ transport: http(), chain: foundry, mode: "anvil" })
    })

    after(function () {
        anvilProcess.kill()
    })

    it("should trace a simple transaction", async () => {
        // debug_traceCall(
        // client: PublicClient | WalletClient,
        // tx: TransactionRequest,
        // options: TraceOptions
        // )

        const from = "0x0000000000000000000000000000000000000069"
        const to = "0x0000000000000000000000000000000000000420"

        // CHAINID
        // PUSH1 0x00
        // MSTORE
        // PUSH1 0x20
        // PUSH1 0x00
        // RETURN
        const bytecode = "0x4660005260206000f3"

        await testClient.setCode({ address: to, bytecode })
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const ret = await debug_traceCall(client, { from: from, to: to, data: "0x" }, { enableMemory: true })
        console.log(ret)
    })
})
