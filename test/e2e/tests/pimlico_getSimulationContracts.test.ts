import type { PimlicoClient } from "permissionless/clients/pimlico"
import { http, createPublicClient } from "viem"
import { foundry } from "viem/chains"
import { beforeAll, beforeEach, describe, expect, inject, test } from "vitest"
import { beforeEachCleanUp, getPimlicoClient } from "../src/utils/index.js"
import { EntryPointVersion } from "viem/account-abstraction"

describe.each([
    { entryPointVersion: "0.6" as EntryPointVersion },
    { entryPointVersion: "0.7" as EntryPointVersion },
    { entryPointVersion: "0.8" as EntryPointVersion }
])(
    "$entryPointVersion supports pimlico_getSimulationContracts",
    ({ entryPointVersion }) => {
        let pimlicoBundlerClient: PimlicoClient
        const anvilRpc = inject("anvilRpc")
        const altoRpc = inject("altoRpc")

        const publicClient = createPublicClient({
            transport: http(anvilRpc),
            chain: foundry
        })

        beforeAll(() => {
            pimlicoBundlerClient = getPimlicoClient({
                entryPointVersion,
                altoRpc
            })
        })

        beforeEach(async () => {
            await beforeEachCleanUp({ anvilRpc, altoRpc })
        })

        test("Get simulation contracts", async () => {
            const response = await fetch(altoRpc, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "pimlico_getSimulationContracts",
                    params: [],
                    id: 4337
                })
            })

            const result = await response.json()
            
            expect(result.result).toBeDefined()
            expect(result.result.pimlicoSimulations).toBeDefined()
            expect(result.result.pimlicoSimulations).toMatch(/^0x[a-fA-F0-9]{40}$/)
            
            if (entryPointVersion === "0.7") {
                expect(result.result.entrypointSimulations07).toBeDefined()
                expect(result.result.entrypointSimulations07).toMatch(/^0x[a-fA-F0-9]{40}$/)
            }
            
            if (entryPointVersion === "0.8") {
                expect(result.result.entrypointSimulations08).toBeDefined()
                expect(result.result.entrypointSimulations08).toMatch(/^0x[a-fA-F0-9]{40}$/)
            }
        })
    }
)