import { type Server, createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { deepHexlify } from "permissionless"
import {
    http,
    type Address,
    type Hex,
    createWalletClient,
    isAddressEqual,
    parseEther
} from "viem"
import {
    type EntryPointVersion,
    type UserOperation,
    type UserOperationReceipt,
    entryPoint07Address
} from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import { foundry } from "viem/chains"
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    inject,
    test
} from "vitest"
import {
    FLAGGED_EXECUTOR_PRIVATE_KEYS,
    startAltoWithFlags
} from "../src/utils/altoInstance.js"
import {
    beforeEachCleanUp,
    clearBundlerState,
    getPublicClient,
    getSmartAccountClient
} from "../src/utils/index.js"

type JsonRpcRequest = { id: number; method: string; params?: unknown[] }

// JSON-RPC proxy in front of anvil that records the requests it receives,
// and whether each transaction send was rejected.
const startRpcProxy = async ({ upstream }: { upstream: string }) => {
    const state: {
        requests: JsonRpcRequest[]
        rejectedSends: string[]
    } = { requests: [], rejectedSends: [] }

    const server: Server = createServer(async (req, res) => {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
            chunks.push(chunk as Buffer)
        }
        const body = Buffer.concat(chunks).toString()
        const parsed = JSON.parse(body) as JsonRpcRequest | JsonRpcRequest[]
        const requests = Array.isArray(parsed) ? parsed : [parsed]
        state.requests.push(...requests)

        const upstreamRes = await fetch(upstream, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body
        })
        const text = await upstreamRes.text()

        if (
            !Array.isArray(parsed) &&
            parsed.method === "eth_sendRawTransaction"
        ) {
            const { error } = JSON.parse(text) as {
                error?: { message: string }
            }
            if (error) {
                state.rejectedSends.push(error.message)
            }
        }

        res.setHeader("content-type", "application/json")
        res.statusCode = upstreamRes.status
        res.end(text)
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

// One executor, so consecutive bundles come from the same wallet.
const EXECUTOR_PRIVATE_KEY = FLAGGED_EXECUTOR_PRIVATE_KEYS.split(",")[0] as Hex
const executor = privateKeyToAccount(EXECUTOR_PRIVATE_KEY)

describe("executor nonce tracking", () => {
    const anvilRpc = inject("anvilRpc")
    const altoRpc = inject("altoRpc")
    const entryPoint = entryPoint07Address
    const entryPointVersion = "0.7" as EntryPointVersion

    let proxy: Awaited<ReturnType<typeof startRpcProxy>>
    let trackingAlto: Awaited<ReturnType<typeof startAltoWithFlags>>

    beforeAll(async () => {
        proxy = await startRpcProxy({ upstream: anvilRpc })
        trackingAlto = await startAltoWithFlags({
            anvilRpc: proxy.url,
            port: 8097,
            flags: { "executor-private-keys": EXECUTOR_PRIVATE_KEY }
        })
    })

    afterAll(async () => {
        await trackingAlto?.stop()
        await proxy?.stop()
    })

    beforeEach(async () => {
        await clearBundlerState({ altoRpc: trackingAlto.altoRpc })
        await beforeEachCleanUp({ anvilRpc, altoRpc })
    })

    // Sends a userOperation with pimlico_sendUserOperationNow and returns
    // the nonce of its bundle transaction, along with the executor nonce
    // reads and rejected sends made while sending it.
    const sendUserOp = async () => {
        const smartAccountClient = await getSmartAccountClient({
            entryPointVersion,
            anvilRpc,
            altoRpc: trackingAlto.altoRpc
        })
        const op = (await smartAccountClient.prepareUserOperation({
            calls: [
                {
                    to: "0x0000000000000000000000000000000000000000",
                    value: parseEther("0.01"),
                    data: "0x"
                }
            ]
        })) as UserOperation
        op.signature = await smartAccountClient.account.signUserOperation(op)

        proxy.state.requests = []
        proxy.state.rejectedSends = []

        const res = await fetch(trackingAlto.altoRpc, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "pimlico_sendUserOperationNow",
                params: [deepHexlify(op), entryPoint]
            })
        })
        const { result, error } = (await res.json()) as {
            result?: UserOperationReceipt
            error?: unknown
        }
        expect(error).toBeUndefined()
        expect(result?.success).toEqual(true)

        const transaction = await getPublicClient(anvilRpc).getTransaction({
            hash: (result as UserOperationReceipt).receipt.transactionHash
        })
        expect(isAddressEqual(transaction.from, executor.address)).toBe(true)

        const executorNonceReads = proxy.state.requests.filter(
            ({ method, params }) =>
                method === "eth_getTransactionCount" &&
                isAddressEqual(params?.[0] as Address, executor.address)
        ).length

        return {
            nonce: transaction.nonce,
            executorNonceReads,
            rejectedSends: [...proxy.state.rejectedSends]
        }
    }

    test("Consecutive bundles from the same executor use the tracked nonce", async () => {
        const first = await sendUserOp()
        const second = await sendUserOp()
        const third = await sendUserOp()

        expect(second.nonce).toEqual(first.nonce + 1)
        expect(third.nonce).toEqual(second.nonce + 1)
        // Known from the previous bundle, not read from the chain.
        expect(second.executorNonceReads).toEqual(0)
        expect(third.executorNonceReads).toEqual(0)
        expect(second.rejectedSends).toEqual([])
        expect(third.rejectedSends).toEqual([])
    })

    test("Recovers when the executor nonce was used outside the bundler", async () => {
        const first = await sendUserOp()

        // Use the executor's next nonce behind the bundler's back, so the
        // nonce it tracked is too low.
        const walletClient = createWalletClient({
            account: executor,
            chain: foundry,
            transport: http(anvilRpc)
        })
        const hash = await walletClient.sendTransaction({
            to: executor.address,
            value: 0n
        })
        await getPublicClient(anvilRpc).waitForTransactionReceipt({ hash })

        // Rejected as nonce too low, then retried with the chain's nonce.
        const second = await sendUserOp()
        expect(second.nonce).toEqual(first.nonce + 2)
        expect(second.rejectedSends).toHaveLength(1)
        expect(second.rejectedSends[0].toLowerCase()).toContain("nonce")

        // Tracked again from the retried bundle.
        const third = await sendUserOp()
        expect(third.nonce).toEqual(second.nonce + 1)
        expect(third.executorNonceReads).toEqual(0)
        expect(third.rejectedSends).toEqual([])
    })
})
