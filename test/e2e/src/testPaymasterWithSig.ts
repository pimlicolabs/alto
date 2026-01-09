// Utils for deploying TestPaymasterWithSig contract (EntryPoint 0.9 only)
// This paymaster validates paymasterSignature field where two uint256 values must add up to 100

import {
    http,
    type Address,
    type Hex,
    concat,
    createPublicClient,
    getCreate2Address,
    pad,
    parseEther
} from "viem"
import { entryPoint09Address } from "viem/account-abstraction"
import { foundry } from "viem/chains"
import { getAnvilWalletClient } from "./utils/index.js"

// TestPaymasterWithSig bytecode
// Expects signedPaymasterData to decode to 0x11
// Expects paymasterSignature to decode to (uint256 a, uint256 b) where a + b == 100
// Get bytecode from: cat contracts/out/TestPaymasterWithSig.sol/TestPaymasterWithSig.json | jq -r '.bytecode.object'
const PAYMASTER_WITH_SIG_BYTECODE: Hex = "BYTECODE_HERE"

export const deployTestPaymasterWithSig = async ({
    anvilRpc,
    salt = "0x0000000000000000000000000000000000000000000000000000000000000001",
    funded = true
}: {
    anvilRpc: string
    salt?: Hex
    funded?: boolean
}): Promise<Address> => {
    const publicClient = createPublicClient({
        transport: http(anvilRpc),
        chain: foundry
    })

    const counterFactual = getCreate2Address({
        from: "0x4e59b44847b379578588920ca78fbf26c0b4956c",
        salt,
        bytecode: concat([PAYMASTER_WITH_SIG_BYTECODE, pad(entryPoint09Address)])
    })

    const bytecode = await publicClient.getCode({
        address: counterFactual
    })

    if (!bytecode) {
        const walletClient = getAnvilWalletClient({
            addressIndex: 0,
            anvilRpc
        })

        await walletClient.sendTransaction({
            data: concat([
                salt,
                PAYMASTER_WITH_SIG_BYTECODE,
                pad(entryPoint09Address)
            ]),
            to: "0x4e59b44847b379578588920ca78fbf26c0b4956c"
        })

        if (funded) {
            await walletClient.sendTransaction({
                to: counterFactual,
                value: parseEther("100"),
                data: "0xd0e30db0" /* sig for deposit() */
            })
        }
    }

    return counterFactual
}
