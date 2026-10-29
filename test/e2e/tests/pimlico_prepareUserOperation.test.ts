import { type Server, createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { deepHexlify } from "permissionless"
import { type Hex, parseEther } from "viem"
import {
    type EntryPointVersion,
    type UserOperation,
    type UserOperationReceipt,
    entryPoint06Address,
    entryPoint07Address,
    entryPoint08Address,
    entryPoint09Address
} from "viem/account-abstraction"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
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
    clearBundlerState,
    getPublicClient,
    getSmartAccountClient
} from "../src/utils/index.js"

const HASH_REGEX = /^0x[0-9a-fA-F]{64}$/
const PROXIED_ALTO_PORT = 8099
const PROXIED_ALTO_TTL_MS = 2_000
// Tests run back to back, so the previous test's executor may not be freed
// by the block loop yet.
const PROXIED_ALTO_EXECUTOR_WAIT_MS = 1_000

type JsonRpcRequest = {
    id: number
    method: string
    params?: unknown[]
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

// JSON-RPC proxy in front of anvil that records the requests it receives.
const startRecordingProxy = async ({ upstream }: { upstream: string }) => {
    const state: { requests: JsonRpcRequest[] } = { requests: [] }

    const server: Server = createServer(async (req, res) => {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
            chunks.push(chunk as Buffer)
        }
        const body = Buffer.concat(chunks).toString()
        const parsed = JSON.parse(body) as JsonRpcRequest | JsonRpcRequest[]
        state.requests.push(...(Array.isArray(parsed) ? parsed : [parsed]))

        const upstreamRes = await fetch(upstream, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body
        })
        res.setHeader("content-type", "application/json")
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

const prepareSignedUserOp = async ({
    entryPointVersion,
    anvilRpc,
    altoRpc,
    boosted = false
}: {
    entryPointVersion: EntryPointVersion
    anvilRpc: string
    altoRpc: string
    // Zero gas fees, the bundler pays the gas.
    boosted?: boolean
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
    if (boosted) {
        op.maxFeePerGas = 0n
        op.maxPriorityFeePerGas = 0n
    }
    op.signature = await smartAccountClient.account.signUserOperation(op)

    return op
}

const prepare = async ({
    altoRpc,
    op,
    entryPoint
}: {
    altoRpc: string
    op: UserOperation
    entryPoint: Hex
}) =>
    rawRpc({
        url: `${altoRpc}/v2/rpc`,
        method: "pimlico_prepareUserOperation",
        params: [deepHexlify(op), entryPoint]
    }) as Promise<{
        result?: { id: Hex; userOpHash: Hex }
        error?: { code: number; message: string; data?: unknown }
    }>

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
    "$entryPointVersion supports pimlico_prepareUserOperation",
    ({ entryPoint, entryPointVersion }) => {
        const anvilRpc = inject("anvilRpc")
        const altoRpc = inject("altoRpc")

        beforeEach(async () => {
            await beforeEachCleanUp({ anvilRpc, altoRpc })
        })

        test("Prepares and sends a userOperation", async () => {
            const op = await prepareSignedUserOp({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const prepared = await prepare({ altoRpc, op, entryPoint })
            expect(prepared.error).toBeUndefined()
            expect(prepared.result?.id).toMatch(HASH_REGEX)
            expect(prepared.result?.userOpHash).toMatch(HASH_REGEX)

            const { result, error } = await rawRpc({
                url: `${altoRpc}/v2/rpc`,
                method: "pimlico_sendPreparedUserOperation",
                params: [prepared.result?.id]
            })

            expect(error).toBeUndefined()
            const receipt = result as UserOperationReceipt
            expect(receipt.success).toEqual(true)
            expect(receipt.userOpHash).toEqual(prepared.result?.userOpHash)

            const txReceipt = await getPublicClient(
                anvilRpc
            ).getTransactionReceipt({
                hash: receipt.receipt.transactionHash
            })
            expect(txReceipt.status).toEqual("success")

            // A prepared userOperation is sent once.
            const again = await rawRpc({
                url: `${altoRpc}/v2/rpc`,
                method: "pimlico_sendPreparedUserOperation",
                params: [prepared.result?.id]
            })
            expect(again.error?.message).toContain(
                "prepared userOperation not found"
            )
        })

        test("Prepares and sends a boosted userOperation", async () => {
            const op = await prepareSignedUserOp({
                entryPointVersion,
                anvilRpc,
                altoRpc,
                boosted: true
            })

            const prepared = await prepare({ altoRpc, op, entryPoint })
            expect(prepared.error).toBeUndefined()

            const { result, error } = await rawRpc({
                url: `${altoRpc}/v2/rpc`,
                method: "pimlico_sendPreparedUserOperation",
                params: [prepared.result?.id]
            })

            expect(error).toBeUndefined()
            const receipt = result as UserOperationReceipt
            expect(receipt.success).toEqual(true)
            // The bundler paid the gas.
            expect(BigInt(receipt.actualGasCost)).toEqual(0n)
        })

        test("Cancels a prepared userOperation", async () => {
            const op = await prepareSignedUserOp({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const prepared = await prepare({ altoRpc, op, entryPoint })
            expect(prepared.error).toBeUndefined()

            const cancelled = await rawRpc({
                url: altoRpc,
                method: "pimlico_cancelPreparedUserOperation",
                params: [prepared.result?.id]
            })
            expect(cancelled.result).toEqual(true)

            const again = await rawRpc({
                url: altoRpc,
                method: "pimlico_cancelPreparedUserOperation",
                params: [prepared.result?.id]
            })
            expect(again.result).toEqual(false)

            const sent = await rawRpc({
                url: altoRpc,
                method: "pimlico_sendPreparedUserOperation",
                params: [prepared.result?.id]
            })
            expect(sent.error?.message).toContain(
                "prepared userOperation not found"
            )

            // The cancel freed the userOperation, so it can be sent.
            const { result, error } = await rawRpc({
                url: `${altoRpc}/v2/rpc`,
                method: "pimlico_sendUserOperationNow",
                params: [deepHexlify(op), entryPoint]
            })
            expect(error).toBeUndefined()
            expect((result as UserOperationReceipt).success).toEqual(true)
        })

        test("Rejects a userOperation that is already prepared", async () => {
            const op = await prepareSignedUserOp({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })

            const first = await prepare({ altoRpc, op, entryPoint })
            expect(first.error).toBeUndefined()

            const second = await prepare({ altoRpc, op, entryPoint })
            expect(second.result).toBeUndefined()
            expect(second.error?.code).toEqual(-32602)
            expect(second.error?.message).toContain(
                "userOperation is already prepared"
            )

            await rawRpc({
                url: altoRpc,
                method: "pimlico_cancelPreparedUserOperation",
                params: [first.result?.id]
            })
        })

        test("Rejects a userOperation that fails simulation", async () => {
            const op = await prepareSignedUserOp({
                entryPointVersion,
                anvilRpc,
                altoRpc
            })
            const signature = op.signature

            // Signed by another key, same userOpHash.
            op.signature = await privateKeyToAccount(
                generatePrivateKey()
            ).signMessage({ message: "not the owner" })

            const rejected = await prepare({ altoRpc, op, entryPoint })
            expect(rejected.result).toBeUndefined()
            expect(rejected.error?.code).toEqual(-32602)
            expect(rejected.error?.message).toContain(
                "userOperation simulation failed"
            )

            // The failed prepare released the userOperation.
            op.signature = signature
            const prepared = await prepare({ altoRpc, op, entryPoint })
            expect(prepared.error).toBeUndefined()

            await rawRpc({
                url: altoRpc,
                method: "pimlico_cancelPreparedUserOperation",
                params: [prepared.result?.id]
            })
        })
    }
)

describe("pimlico_sendPreparedUserOperation", () => {
    const anvilRpc = inject("anvilRpc")
    const altoRpc = inject("altoRpc")
    const entryPoint = entryPoint07Address
    const entryPointVersion = "0.7" as EntryPointVersion

    let proxy: Awaited<ReturnType<typeof startRecordingProxy>>
    let proxiedAlto: Awaited<ReturnType<typeof startAltoWithFlags>>

    beforeAll(async () => {
        proxy = await startRecordingProxy({ upstream: anvilRpc })
        proxiedAlto = await startAltoWithFlags({
            anvilRpc: proxy.url,
            port: PROXIED_ALTO_PORT,
            flags: {
                "instant-bundling-executor-wait": PROXIED_ALTO_EXECUTOR_WAIT_MS,
                "prepared-user-operation-ttl": PROXIED_ALTO_TTL_MS
            }
        })
    })

    afterAll(async () => {
        await proxiedAlto?.stop()
        await proxy?.stop()
    })

    beforeEach(async () => {
        await clearBundlerState({ altoRpc: proxiedAlto.altoRpc })
        await beforeEachCleanUp({ anvilRpc, altoRpc })
    })

    test("Doesn't simulate the userOperation again", async () => {
        const op = await prepareSignedUserOp({
            entryPointVersion,
            anvilRpc,
            altoRpc: proxiedAlto.altoRpc
        })

        const prepared = await prepare({
            altoRpc: proxiedAlto.altoRpc,
            op,
            entryPoint
        })
        expect(prepared.error).toBeUndefined()

        proxy.state.requests = []
        const { result, error } = await rawRpc({
            url: proxiedAlto.altoRpc,
            method: "pimlico_sendPreparedUserOperation",
            params: [prepared.result?.id]
        })

        expect(error).toBeUndefined()
        expect((result as UserOperationReceipt).success).toEqual(true)
        const methods = proxy.state.requests.map(({ method }) => method)
        expect(methods).toContain("eth_getTransactionCount")
        expect(methods).not.toContain("eth_call")

        // pimlico_sendUserOperationNow simulates with eth_call.
        const other = await prepareSignedUserOp({
            entryPointVersion,
            anvilRpc,
            altoRpc: proxiedAlto.altoRpc
        })
        proxy.state.requests = []
        const now = await rawRpc({
            url: proxiedAlto.altoRpc,
            method: "pimlico_sendUserOperationNow",
            params: [deepHexlify(other), entryPoint]
        })
        expect(now.error).toBeUndefined()
        expect(proxy.state.requests.map(({ method }) => method)).toContain(
            "eth_call"
        )
    })

    test("Drops a prepared userOperation after its TTL", async () => {
        const op = await prepareSignedUserOp({
            entryPointVersion,
            anvilRpc,
            altoRpc: proxiedAlto.altoRpc
        })

        const prepared = await prepare({
            altoRpc: proxiedAlto.altoRpc,
            op,
            entryPoint
        })
        expect(prepared.error).toBeUndefined()

        await new Promise((resolve) =>
            setTimeout(resolve, PROXIED_ALTO_TTL_MS + 500)
        )

        const expired = await rawRpc({
            url: proxiedAlto.altoRpc,
            method: "pimlico_sendPreparedUserOperation",
            params: [prepared.result?.id]
        })
        expect(expired.error?.message).toContain(
            "prepared userOperation not found"
        )

        // The userOperation was released, so it can be prepared again.
        const again = await prepare({
            altoRpc: proxiedAlto.altoRpc,
            op,
            entryPoint
        })
        expect(again.error).toBeUndefined()

        const { result, error } = await rawRpc({
            url: proxiedAlto.altoRpc,
            method: "pimlico_sendPreparedUserOperation",
            params: [again.result?.id]
        })
        expect(error).toBeUndefined()
        expect((result as UserOperationReceipt).success).toEqual(true)
    })
})
