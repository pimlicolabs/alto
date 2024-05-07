import { Client, Hex, createClient, http, numberToHex, zeroAddress } from "viem"
import { test, beforeAll, describe, expect } from "vitest"
import { foundry } from "viem/chains"
import {
    ALTO_RPC,
    ENTRYPOINT_ADDRESS_V06,
    ENTRYPOINT_ADDRESS_V07
} from "../../src/constants"
import { buildOpV07 } from "../../src/userOperationBuilder"

let bundlerClient: Client

beforeAll(async () => {
    bundlerClient = createClient({
        transport: http(ALTO_RPC),
        chain: foundry
    })
})

describe("Should support eth_chainId and eth_supportedEntryPoints", () => {
    test("Can fetch chainId", async () => {
        const chainId = await bundlerClient.request({
            method: "eth_chainId"
        })

        expect(chainId).toBe(numberToHex(foundry.id))
    })

    test("Can fetch supported EntryPoints", async () => {
        const supportedEntryPoints = await bundlerClient.request({
            // @ts-ignore
            method: "eth_supportedEntryPoints"
        })

        expect(supportedEntryPoints).toStrictEqual([
            ENTRYPOINT_ADDRESS_V06,
            ENTRYPOINT_ADDRESS_V07
        ])
    })
})

describe("Should support eth_estimateUserOperationGas", () => {
    test("Can estimate with missing gasPrice and gasLimit values", async () => {
        const op = await buildOpV07({
            params: { to: zeroAddress, value: 0n, calldata: "0x" }
        })

        const gasParams = (await bundlerClient.request({
            // @ts-ignore
            method: "eth_estimateUserOperationGas",
            // @ts-ignore
            params: [op, ENTRYPOINT_ADDRESS_V07]
        })) as any

        expect(gasParams).toBe(true)
        expect(gasParams.verifictaionGasLimit).not.toBeNull()
        expect(gasParams.preVerificationGas).not.toBeNull()
        expect(gasParams.callGasLimit).not.toBeNull()
    })

    test("Can estimate with gasPrice and missing gasLimit values", async () => {
        let op = await buildOpV07({
            params: { to: zeroAddress, value: 0n, calldata: "0x" }
        })
        op = { op, maxFeePerGas }

        const gasParams = (await bundlerClient.request({
            // @ts-ignore
            method: "eth_estimateUserOperationGas",
            // @ts-ignore
            params: [op, ENTRYPOINT_ADDRESS_V07]
        })) as any

        expect(gasParams).toBe(true)
        expect(gasParams.verifictaionGasLimit).not.toBeNull()
        expect(gasParams.preVerificationGas).not.toBeNull()
        expect(gasParams.callGasLimit).not.toBeNull()
    })
})
