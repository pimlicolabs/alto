import { http } from "viem"
import {
    createBundlerClient,
    entryPoint06Address,
    entryPoint07Address
} from "viem/account-abstraction"
import { expect, inject, beforeEach, test } from "vitest"
import { beforeEachCleanUp } from "../src/utils/index.js"
import { entryPoint08Address } from "../src/constants.js"

const anvilRpc = inject("anvilRpc")
const altoRpc = inject("altoRpc")

beforeEach(async () => {
    await beforeEachCleanUp({ anvilRpc, altoRpc })
})

test("Should throw if EntryPoint is not supported", async () => {
    const actualEntryPoints = [
        entryPoint06Address,
        entryPoint07Address,
        entryPoint08Address
    ]

    const bundlerClient = createBundlerClient({
        transport: http(altoRpc)
    })

    const supportedEntryPoints = await bundlerClient.getSupportedEntryPoints()

    expect([...supportedEntryPoints].sort()).toEqual(
        [...actualEntryPoints].sort()
    )
})
