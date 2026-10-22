import { type Server, createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { deepHexlify } from "permissionless"
import { http, type Hex, createClient, parseEther } from "viem"
import {
    type EntryPointVersion,
    type UserOperation,
    type UserOperationReceipt,
    entryPoint06Address,
    entryPoint07Address,
    entryPoint08Address,
    entryPoint09Address
} from "viem/account-abstraction"
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    inject,
    test
} from "vitest"
import { startAltoWithFlags } from "../src/utils/altoInstance.js"
import {
    beforeEachCleanUp,
    getPublicClient,
    getSmartAccountClient
} from "../src/utils/index.js"

const PROXIED_ALTO_PORT = 8093
const PROXIED_ALTO_INSTANT_TIMEOUT_MS = 3_000
const HASH_REGEX = /^0x[0-9a-fA-F]{64}$/

// How the proxy answers eth_sendRawTransactionSync:
// - passthrough: forwards it to anvil (EIP-7966 supported).
// - unsupported: answers -32601 like an endpoint without EIP-7966.
// - pending: answers the EIP-7966 timeout (code 4) without forwarding, so
//   the transaction never lands.
type SyncMode = "passthrough" | "unsupported" | "pending"

type JsonRpcRequest = { id: number; method: string }

// JSON-RPC proxy in front of anvil that records the methods it receives.
const startRpcProxy = async ({ upstream }: { upstream: string }) => {
    const state: { syncMode: SyncMode; methods: string[] } = {
        syncMode: "passthrough",
        methods: []
    }

    const server: Server = createServer(async (req, res) => {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
            chunks.push(chunk as Buffer)
        }
        const body = Buffer.concat(chunks).toString()
        const parsed = JSON.parse(body) as JsonRpcRequest | JsonRpcRequest[]
        const requests = Array.isArray(parsed) ? parsed : [parsed]
        state.methods.push(...requests.map(({ method }) => method))

        res.setHeader("content-type", "application/json")

        if (
            !Array.isArray(parsed) &&
            parsed.method === "eth_sendRawTransactionSync" &&
            state.syncMode !== "passthrough"
        ) {
            const error =
                state.syncMode === "unsupported"
                    ? { code: -32601, message: "Method not found" }
                    : {
                          code: 4,
                          message:
                              "The transaction was added to the transaction pool but wasn't processed in time"
                      }
            res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, error }))
            return
        }

        const upstreamRes = await fetch(upstream, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body
        })
        res.statusCode = upstreamRes.status
        res.end(await upstreamRes.text())
    })

    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve())
    )
    const { port } = server.address() as AddressInfo

    return {
        url: `http://127.0.0.1:${port}`,
        state,
        stop: () =>
            new Promise<void>((resolve) => {
                server.closeAllConnections()
                server.close(() => resolve())
            })
    }
}

// Raw JSON-RPC call, so error.data is visible.
const rawRpc = async ({
    url,
    method,
    params
}: {
    url: string
    method: string
    params: unknown[]
}): Promise<{
    result?: unknown
    error?: { code: number; message: string; data?: unknown }
}> => {
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    })
    return (await res.json()) as {
        result?: unknown
        error?: { code: number; message: string; data?: unknown }
    }
}

const prepareSignedUserOp = async ({
    entryPointVersion,
    anvilRpc,
    altoRpc
}: {
    entryPointVersion: EntryPointVersion
    anvilRpc: string
    altoRpc: string
}) => {
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
    op.signature = await smartAccountClient.account.signUserOperation(op)

    return op
}

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
    },
    {
        entryPoint: entryPoint09Address,
        entryPointVersion: "0.9" as EntryPointVersion
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
            const op = await prepareSignedUserOp({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

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

            // The receipt is returned once the bundle is onchain.
            const txReceipt = await getPublicClient(
                anvilRpc
            ).getTransactionReceipt({
                hash: receipt.receipt.transactionHash
            })
            expect(txReceipt.status).toEqual("success")
        })
    }
)

describe("pimlico_sendUserOperationNow send paths", () => {
    const anvilRpc = inject("anvilRpc")
    const altoRpc = inject("altoRpc")
    const entryPoint = entryPoint07Address
    const entryPointVersion = "0.7" as EntryPointVersion

    let proxy: Awaited<ReturnType<typeof startRpcProxy>>
    let proxiedAlto: Awaited<ReturnType<typeof startAltoWithFlags>>

    beforeAll(async () => {
        proxy = await startRpcProxy({ upstream: anvilRpc })
        proxiedAlto = await startAltoWithFlags({
            anvilRpc: proxy.url,
            port: PROXIED_ALTO_PORT,
            flags: {
                "instant-bundling-timeout": PROXIED_ALTO_INSTANT_TIMEOUT_MS
            }
        })
    })

    afterAll(async () => {
        await proxiedAlto?.stop()
        await proxy?.stop()
    })

    beforeEach(async () => {
        await beforeEachCleanUp({ anvilRpc, altoRpc })
        proxy.state.syncMode = "passthrough"
        proxy.state.methods = []
    })

    test("Sends with eth_sendRawTransactionSync when supported", async () => {
        const op = await prepareSignedUserOp({
            entryPointVersion,
            anvilRpc,
            altoRpc: proxiedAlto.altoRpc
        })
        proxy.state.methods = []

        const { result, error } = await rawRpc({
            url: proxiedAlto.altoRpc,
            method: "pimlico_sendUserOperationNow",
            params: [deepHexlify(op), entryPoint]
        })

        expect(error).toBeUndefined()
        const receipt = result as UserOperationReceipt
        expect(receipt.success).toEqual(true)
        expect(proxy.state.methods).toContain("eth_sendRawTransactionSync")
        expect(proxy.state.methods).not.toContain("eth_sendRawTransaction")
    })

    test("Falls back to eth_sendRawTransaction when unsupported", async () => {
        const op = await prepareSignedUserOp({
            entryPointVersion,
            anvilRpc,
            altoRpc: proxiedAlto.altoRpc
        })
        proxy.state.syncMode = "unsupported"
        proxy.state.methods = []

        const { result, error } = await rawRpc({
            url: proxiedAlto.altoRpc,
            method: "pimlico_sendUserOperationNow",
            params: [deepHexlify(op), entryPoint]
        })

        expect(error).toBeUndefined()
        const receipt = result as UserOperationReceipt
        expect(receipt.success).toEqual(true)
        expect(proxy.state.methods).toContain("eth_sendRawTransactionSync")
        expect(proxy.state.methods).toContain("eth_sendRawTransaction")

        const txReceipt = await getPublicClient(anvilRpc).getTransactionReceipt(
            {
                hash: receipt.receipt.transactionHash
            }
        )
        expect(txReceipt.status).toEqual("success")
    })

    // Keep last: the dropped bundle stays tracked by the proxied instance.
    test("Returns a timeout error with the hashes when not included", async () => {
        const op = await prepareSignedUserOp({
            entryPointVersion,
            anvilRpc,
            altoRpc: proxiedAlto.altoRpc
        })
        proxy.state.syncMode = "pending"

        const start = Date.now()
        const { result, error } = await rawRpc({
            url: proxiedAlto.altoRpc,
            method: "pimlico_sendUserOperationNow",
            params: [deepHexlify(op), entryPoint]
        })
        const elapsed = Date.now() - start

        expect(result).toBeUndefined()
        expect(error?.code).toEqual(-32602)
        expect(error?.message).toContain("not yet included")
        const data = error?.data as { userOpHash: Hex; transactionHash: Hex }
        expect(data.userOpHash).toMatch(HASH_REGEX)
        expect(data.transactionHash).toMatch(HASH_REGEX)
        expect(elapsed).toBeLessThan(PROXIED_ALTO_INSTANT_TIMEOUT_MS + 2_000)
    })
})
