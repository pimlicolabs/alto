import { http, createTestClient, parseEther } from "viem"
import {
    type EntryPointVersion,
    entryPoint07Address
} from "viem/account-abstraction"
import { foundry } from "viem/chains"
import { beforeEach, describe, expect, inject, test } from "vitest"
import { beforeEachCleanUp, getSmartAccountClient } from "../src/utils/index.js"

// Requires "reorg-confirmation-depth" > 0 in alto-config.json.
describe("reorg protection", () => {
    const entryPointVersion = "0.7" as EntryPointVersion
    const entryPoint = entryPoint07Address

    const anvilRpc = inject("anvilRpc")
    const altoRpc = inject("altoRpc")

    const anvilClient = createTestClient({
        transport: http(anvilRpc),
        chain: foundry,
        mode: "anvil"
    })

    beforeEach(async () => {
        await beforeEachCleanUp({ anvilRpc, altoRpc })
    })

    test("resubmits userOps whose inclusion block was orphaned by a reorg", async () => {
        const smartAccountClient = await getSmartAccountClient({
            entryPointVersion,
            anvilRpc,
            altoRpc
        })

        // Snapshot before inclusion so evm_revert orphans the bundle's block
        // (and un-spends the account nonce, like a real reorg would).
        const snapshotId = await anvilClient.snapshot()
        console.log(`REORG_TEST: snapshot taken (id: ${snapshotId})`)

        const userOpHash = await smartAccountClient.sendUserOperation({
            calls: [
                {
                    to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                    value: parseEther("0.01")
                }
            ]
        })
        console.log(`REORG_TEST: userOp sent (hash: ${userOpHash})`)

        const originalReceipt =
            await smartAccountClient.waitForUserOperationReceipt({
                hash: userOpHash
            })
        const originalTxHash = originalReceipt.receipt.transactionHash
        console.log(
            `REORG_TEST: userOp included (tx: ${originalTxHash}, block: ${originalReceipt.receipt.blockNumber})`
        )

        // Orphan the inclusion block, then advance the head past
        // reorg-confirmation-depth so alto's verification runs.
        await anvilClient.revert({ id: snapshotId })
        console.log(
            "REORG_TEST: evm_revert executed, inclusion block orphaned"
        )
        await anvilClient.mine({ blocks: 4 })
        console.log(
            "REORG_TEST: mined 4 blocks, head is now past reorg-confirmation-depth"
        )

        // Alto should detect the missing receipt, probe for a rival
        // inclusion, resubmit through the mempool, and get the op
        // re-included under a new transaction.
        const start = Date.now()
        while (true) {
            expect(Date.now() - start).toBeLessThan(50_000)

            // Keep the chain moving so the recovery probe and the block
            // watcher see fresh blocks.
            await anvilClient.mine({ blocks: 1 })
            await new Promise((resolve) => setTimeout(resolve, 500))

            const receipt = await smartAccountClient
                .getUserOperationReceipt({ hash: userOpHash })
                .catch(() => null)

            if (!receipt) {
                console.log(
                    "REORG_TEST: polling... receipt not found yet (stale receipt purged, awaiting resubmission)"
                )
                continue
            }

            if (receipt.receipt.transactionHash === originalTxHash) {
                console.log(
                    `REORG_TEST: polling... still seeing the orphaned tx (${originalTxHash}), recovery pending`
                )
                continue
            }

            console.log(
                `REORG_TEST: userOp re-included after reorg (old tx: ${originalTxHash}, new tx: ${receipt.receipt.transactionHash}, block: ${receipt.receipt.blockNumber})`
            )
            expect(receipt.success).toBe(true)
            console.log(
                `REORG_TEST: PASS - reorged userOp recovered in ${Date.now() - start}ms`
            )
            break
        }
    }, 60_000)

    test("settles cleanly when no reorg occurs", async () => {
        const smartAccountClient = await getSmartAccountClient({
            entryPointVersion,
            anvilRpc,
            altoRpc
        })

        const userOpHash = await smartAccountClient.sendUserOperation({
            calls: [
                {
                    to: "0x23B608675a2B2fB1890d3ABBd85c5775c51691d5",
                    value: parseEther("0.01")
                }
            ]
        })
        console.log(`REORG_TEST: userOp sent (hash: ${userOpHash})`)

        const originalReceipt =
            await smartAccountClient.waitForUserOperationReceipt({
                hash: userOpHash
            })
        const originalTxHash = originalReceipt.receipt.transactionHash
        console.log(
            `REORG_TEST: userOp included (tx: ${originalTxHash}, block: ${originalReceipt.receipt.blockNumber})`
        )

        // Advance past confirmation depth and give the verification a
        // moment to run: nothing should change.
        await anvilClient.mine({ blocks: 3 })
        console.log(
            "REORG_TEST: mined 3 blocks past confirmation depth, waiting for alto's verification to run"
        )
        await new Promise((resolve) => setTimeout(resolve, 3_000))

        const receipt = await smartAccountClient.getUserOperationReceipt({
            hash: userOpHash
        })
        console.log(
            `REORG_TEST: receipt after verification (tx: ${receipt.receipt.transactionHash})`
        )
        expect(receipt.receipt.transactionHash).toBe(originalTxHash)
        expect(receipt.success).toBe(true)
        console.log(
            "REORG_TEST: PASS - bundle settled cleanly, receipt unchanged"
        )
    }, 30_000)
})
