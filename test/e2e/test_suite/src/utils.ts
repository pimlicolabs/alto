import { createWalletClient, http } from "viem"
import { Address, mnemonicToAccount } from "viem/accounts"
import { foundry } from "viem/chains"

export const BUNDLE_BULKER_ADDRESS = "0x09aeBCF1DF7d4D0FBf26073e79A6B250f458fFB8"
export const PER_OP_INFLATOR_ADDRESS = "0xcc2cCFF1dC613D41A5132D5EaBb99e7b28577707"
export const ENTRY_POINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
export const SIMPLE_ACCOUNT_FACTORY_ADDRESS = "0x9406Cc6185a346906296840746125a0E44976454"
export const SIMPLE_PASSTHROUGH_INFLATOR = "0x0000000000000000000000000000000000000000"

export const anvilEndpoint = process.env.ANVIL_ENDPOINT ?? "http://127.0.0.1:8545"
export const altoEndpoint = process.env.ALTO_ENDPOINT ?? "http://0.0.0.0:3000"
export const anvilAccount = mnemonicToAccount("test test test test test test test test test test test junk")

export const fundAccount = async (to: Address, value: bigint) => {
    const wallet = createWalletClient({
        account: anvilAccount,
        chain: foundry,
        transport: http(anvilEndpoint),
    })
    await wallet.sendTransaction({
        to,
        value,
    })
}

// creates a checkpoint and returns the hexstring for that checkpoint.
export const anvilDumpState = async (): Promise<string> => {
    return await fetch(anvilEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'anvil_dumpState',
            params: [],
            id: 1
        })
    })
    .then(response => response.json())
}

// loads a checkpoint from the hexstring.
export const anvilLoadState = async (checkpoint: string) => {
    return await fetch(anvilEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'anvil_loadState',
            params: [checkpoint],
            id: 1
        })
    })
}
