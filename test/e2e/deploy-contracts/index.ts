import {
    http,
    type Address,
    createPublicClient,
    createWalletClient,
    type PublicClient
} from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { foundry } from "viem/chains"
import {
    ENTRY_POINT_SIMULATIONS_CREATECALL,
    ENTRY_POINT_V06_CREATECALL,
    ENTRY_POINT_V07_CREATECALL,
    SIMPLE_ACCOUNT_FACTORY_V06_CREATECALL,
    SIMPLE_ACCOUNT_FACTORY_V07_CREATECALL
} from "./constants.js"

const DETERMINISTIC_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c"

const verifyDeployed = async ({
    addresses,
    client
}: { addresses: Address[]; client: PublicClient }) => {
    for (const address of addresses) {
        const bytecode = await client.getBytecode({
            address
        })

        if (bytecode === undefined) {
            console.log(`CONTRACT ${address} NOT DEPLOYED!!!`)
            process.exit(1)
        }
    }
}

export async function setupContracts({ anvilRpc }: { anvilRpc: string }) {
    let nonce = 0

    const walletClient = createWalletClient({
        account: mnemonicToAccount(
            "test test test test test test test test test test test junk"
        ),
        chain: foundry,
        transport: http(anvilRpc)
    })

    const client = createPublicClient({
        transport: http(anvilRpc)
    })

    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: ENTRY_POINT_V07_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[V0.7 CORE] Deploying EntryPoint"))

    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SIMPLE_ACCOUNT_FACTORY_V07_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[V0.7 CORE] Deploying SimpleAccountFactory"))

    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: ENTRY_POINT_SIMULATIONS_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(async () =>
            console.log("[V0.7 CORE] Deploying EntryPointSimulations")
        )

    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: ENTRY_POINT_V06_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[V0.6 CORE] Deploying EntryPoint"))

    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SIMPLE_ACCOUNT_FACTORY_V06_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[V0.6 CORE] Deploying SimpleAccountFactory"))

    // Wait for all deploy/setup txs to be mined.
    let onchainNonce = 0
    do {
        onchainNonce = await client.getTransactionCount({
            address: walletClient.account.address
        })
        await new Promise((resolve) => setTimeout(resolve, 500))
    } while (onchainNonce !== nonce)

    console.log("okay")

    await verifyDeployed({
        client,
        addresses: [
            "0x4e59b44847b379578588920ca78fbf26c0b4956c",
            "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
            "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985",
            "0xe1b9bcD4DbfAE61585691bdB9A100fbaAF6C8dB0" // 0.7 Simulations Contract
        ]
    })
}
