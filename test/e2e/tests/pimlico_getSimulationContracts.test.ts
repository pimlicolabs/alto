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
            const result = await pimlicoBundlerClient.request({
                // @ts-ignore
                method: "pimlico_getSimulationContracts",
                params: []
            })
            
            expect(result).toBeDefined()
            expect(result.pimlicoSimulations).toBeDefined()
            expect(result.pimlicoSimulations).toMatch(/^0x[a-fA-F0-9]{40}$/)
            
            if (entryPointVersion === "0.7") {
                expect(result.entrypointSimulations07).toBeDefined()
                expect(result.entrypointSimulations07).toMatch(/^0x[a-fA-F0-9]{40}$/)
            }
            
            if (entryPointVersion === "0.8") {
                expect(result.entrypointSimulations08).toBeDefined()
                expect(result.entrypointSimulations08).toMatch(/^0x[a-fA-F0-9]{40}$/)
            }
        })
    }
)