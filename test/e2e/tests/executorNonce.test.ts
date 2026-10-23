import type { Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { describe, expect, test } from "vitest"
import type { AltoConfig } from "../../../src/createConfig"
import {
    getNextNonceAfterMinedBundle,
    hasAttemptedSend
} from "../../../src/executor/executorNonce"
import type { SenderManager } from "../../../src/executor/senderManager"
import { createMemorySenderManager } from "../../../src/executor/senderManager/createMemorySenderManager"
import { createRedisSenderManager } from "../../../src/executor/senderManager/createRedisSenderManager"
import type { BundleResult } from "../../../src/types"
import type { Metrics } from "../../../src/utils"

// Unit tests for the executor nonce tracking, they don't use the chain.
// The Redis cases run when REDIS_URL is set.
const REDIS_URL = process.env.REDIS_URL

const noop = () => undefined
const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop
}
const metrics = {
    walletsTotal: { set: noop },
    walletsAvailable: { set: noop }
} as unknown as Metrics

const createConfig = ({
    executorPrivateKeys,
    redisKeyPrefix
}: {
    executorPrivateKeys: Hex[]
    redisKeyPrefix: string
}) =>
    ({
        executorPrivateKeys: executorPrivateKeys.map((key) =>
            privateKeyToAccount(key)
        ),
        maxExecutors: undefined,
        logLevel: "silent",
        redisKeyPrefix,
        chainId: 31337,
        getLogger: () => logger
    }) as unknown as AltoConfig

// Sender managers sharing one wallet, like alto instances sharing executors.
type CreateSenderManagers = (count: number) => Promise<SenderManager[]>

const createMemorySenderManagers: CreateSenderManagers = async () => [
    createMemorySenderManager({
        config: createConfig({
            executorPrivateKeys: [generatePrivateKey()],
            redisKeyPrefix: "unused"
        }),
        metrics
    })
]

const createRedisSenderManagers: CreateSenderManagers = async (count) => {
    const executorPrivateKeys = [generatePrivateKey()]
    // Fresh keys per test so tests don't share the pool.
    const redisKeyPrefix = `alto-nonce-test-${Date.now()}-${Math.random()}`
    return await Promise.all(
        Array.from({ length: count }, () =>
            createRedisSenderManager({
                config: createConfig({ executorPrivateKeys, redisKeyPrefix }),
                metrics,
                redisEndpoint: REDIS_URL as string
            })
        )
    )
}

const SUBMITTED_BUNDLE = {
    transactionHash: `0x${"ab".repeat(32)}` as Hex,
    transactionRequest: {
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 41
    }
}

describe("executor nonce rules", () => {
    test("A mined bundle transaction gives the next nonce", () => {
        expect(
            getNextNonceAfterMinedBundle({
                submittedBundle: SUBMITTED_BUNDLE,
                minedTransactionHash: SUBMITTED_BUNDLE.transactionHash
            })
        ).toEqual(42)

        // Hashes compare case-insensitively.
        expect(
            getNextNonceAfterMinedBundle({
                submittedBundle: SUBMITTED_BUNDLE,
                minedTransactionHash: `0x${"AB".repeat(32)}`
            })
        ).toEqual(42)
    })

    test("An earlier transaction of the bundle being mined leaves the nonce unknown", () => {
        expect(
            getNextNonceAfterMinedBundle({
                submittedBundle: SUBMITTED_BUNDLE,
                minedTransactionHash: `0x${"cd".repeat(32)}`
            })
        ).toBeUndefined()
    })

    test("Only filterOps failures send no transaction", () => {
        const failure = (reason: string) =>
            ({
                success: false,
                reason,
                rejectedUserOps: [],
                recoverableOps: []
            }) as unknown as BundleResult

        expect(
            hasAttemptedSend({ success: true } as unknown as BundleResult)
        ).toEqual(true)
        expect(hasAttemptedSend(failure("filterops_failed"))).toEqual(false)
        expect(hasAttemptedSend(failure("filterops_unhandled_error"))).toEqual(
            false
        )
        // The send was attempted, it may have reached a node.
        expect(hasAttemptedSend(failure("generic_error"))).toEqual(true)
        expect(hasAttemptedSend(failure("insufficient_funds"))).toEqual(true)
        expect(hasAttemptedSend(failure("nonce_conflict"))).toEqual(true)
    })
})

describe.each([
    { mode: "memory", createSenderManagers: createMemorySenderManagers },
    {
        mode: "redis",
        createSenderManagers: createRedisSenderManagers,
        skip: !REDIS_URL
    }
])("$mode sender manager nonce handover", ({ createSenderManagers, skip }) => {
    test.skipIf(skip)("A wallet starts without a nonce", async () => {
        const [senderManager] = await createSenderManagers(1)

        const wallet = await senderManager.getWallet()
        expect(senderManager.getNextNonce(wallet)).toBeUndefined()
    })

    test.skipIf(skip)("The nonce is handed over with the wallet", async () => {
        const [senderManager] = await createSenderManagers(1)

        const wallet = await senderManager.getWallet()
        senderManager.setNextNonce({ wallet, nonce: 7 })
        expect(senderManager.getNextNonce(wallet)).toEqual(7)
        await senderManager.markWalletProcessed(wallet)

        const next = await senderManager.getWallet()
        expect(next.address).toEqual(wallet.address)
        expect(senderManager.getNextNonce(next)).toEqual(7)
    })

    test.skipIf(skip)("A forgotten nonce stays forgotten", async () => {
        const [senderManager] = await createSenderManagers(1)

        const wallet = await senderManager.getWallet()
        senderManager.setNextNonce({ wallet, nonce: 7 })
        await senderManager.clearNextNonce(wallet.address)
        await senderManager.markWalletProcessed(wallet)

        const next = await senderManager.getWallet()
        expect(senderManager.getNextNonce(next)).toBeUndefined()
    })

    test.skipIf(skip)("A released wallet's nonce can be cleared", async () => {
        const [senderManager] = await createSenderManagers(1)

        const wallet = await senderManager.getWallet()
        senderManager.setNextNonce({ wallet, nonce: 7 })
        await senderManager.markWalletProcessed(wallet)
        await senderManager.clearNextNonce(wallet.address)

        const next = await senderManager.getWallet()
        expect(senderManager.getNextNonce(next)).toBeUndefined()
    })

    test.skipIf(skip)("A leased wallet's nonce can be cleared", async () => {
        const [senderManager] = await createSenderManagers(1)

        const wallet = await senderManager.getWallet()
        senderManager.setNextNonce({ wallet, nonce: 7 })
        await senderManager.clearNextNonce(wallet.address)
        expect(senderManager.getNextNonce(wallet)).toBeUndefined()
        await senderManager.markWalletProcessed(wallet)

        const next = await senderManager.getWallet()
        expect(senderManager.getNextNonce(next)).toBeUndefined()
    })
})

describe("redis sender manager nonce handover between instances", () => {
    test.skipIf(!REDIS_URL)(
        "The nonce moves with the wallet to another instance",
        async () => {
            const [first, second] = await createRedisSenderManagers(2)

            const wallet = await first.getWallet()
            first.setNextNonce({ wallet, nonce: 7 })
            await first.markWalletProcessed(wallet)
            // Released, so no longer known locally.
            expect(first.getNextNonce(wallet)).toBeUndefined()

            const leased = await second.getWallet()
            expect(leased.address).toEqual(wallet.address)
            expect(second.getNextNonce(leased)).toEqual(7)
        }
    )

    test.skipIf(!REDIS_URL)(
        "Only the leaseholder sets the nonce, and it is taken with the lease",
        async () => {
            const [first, second] = await createRedisSenderManagers(2)

            const wallet = await first.getWallet()
            first.setNextNonce({ wallet, nonce: 7 })
            await first.markWalletProcessed(wallet)

            const leased = await second.getWallet()
            // Not leased by the first instance anymore.
            first.setNextNonce({ wallet, nonce: 100 })
            // Taken with the lease: clearing from elsewhere doesn't
            // change what the leaseholder knows.
            await first.clearNextNonce(wallet.address)
            expect(second.getNextNonce(leased)).toEqual(7)

            second.setNextNonce({ wallet: leased, nonce: 8 })
            await second.markWalletProcessed(leased)

            const again = await first.getWallet()
            expect(first.getNextNonce(again)).toEqual(8)
        }
    )

    test.skipIf(!REDIS_URL)(
        "A wallet released with an unknown nonce clears the stored one",
        async () => {
            const [first, second] = await createRedisSenderManagers(2)

            const wallet = await first.getWallet()
            first.setNextNonce({ wallet, nonce: 7 })
            await first.markWalletProcessed(wallet)

            const leased = await second.getWallet()
            await second.clearNextNonce(leased.address)
            await second.markWalletProcessed(leased)

            const again = await first.getWallet()
            expect(first.getNextNonce(again)).toBeUndefined()
        }
    )
})
