import {
    http,
    type Address,
    type PublicClient,
    createPublicClient,
    createWalletClient
} from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { foundry } from "viem/chains"
import {
    ENTRY_POINT_V06_CREATECALL,
    ENTRY_POINT_V07_CREATECALL,
    ENTRY_POINT_V08_CREATECALL,
    SIMPLE_7702_ACCOUNT_IMPLEMENTATION_V06_CREATECALL,
    SIMPLE_7702_ACCOUNT_IMPLEMENTATION_V07_CREATECALL,
    SIMPLE_7702_ACCOUNT_IMPLEMENTATION_V08_CREATECALL,
    SIMPLE_ACCOUNT_FACTORY_V06_CREATECALL,
    SIMPLE_ACCOUNT_FACTORY_V07_CREATECALL,
    SIMPLE_ACCOUNT_FACTORY_V08_CREATECALL
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
            data: SIMPLE_7702_ACCOUNT_IMPLEMENTATION_V08_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() =>
            console.log(
                "[7702] Deploying Simple7702AccountImplementation (0.8)"
            )
        )

    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SIMPLE_7702_ACCOUNT_IMPLEMENTATION_V07_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() =>
            console.log(
                "[7702] Deploying Simple7702AccountImplementation (0.7)"
            )
        )

    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SIMPLE_7702_ACCOUNT_IMPLEMENTATION_V06_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() =>
            console.log(
                "[7702] Deploying Simple7702AccountImplementation (0.6)"
            )
        )

    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: ENTRY_POINT_V08_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[V0.8 CORE] Deploying EntryPoint"))

    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SIMPLE_ACCOUNT_FACTORY_V08_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[V0.8 CORE] Deploying SimpleAccountFactory"))

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
            "0x4e59b44847b379578588920ca78fbf26c0b4956c", // Deterministic deployer
            "0x4337084d9e255ff0702461cf8895ce9e3b5ff108", // EntryPoint 0.8
            "0x13E9ed32155810FDbd067D4522C492D6f68E5944", // SimpleAccountFactory 0.8
            "0xe6Cae83BdE06E4c305530e199D7217f42808555B", // Simple7702Account Implementation 0.8
            "0x0000000071727De22E5E9d8BAf0edAc6f37da032", // EntryPoint 0.7
            "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985", // SimpleAccountFactory 0.7
            "0xf3F57446bEC27F6531EFF3Da2B917ebA8F9BA49c", // Simple7702Account Implementation 0.7
            "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", // EntryPoint 0.6
            "0x9406Cc6185a346906296840746125a0E44976454", // SimpleAcountFactory 0.6
            "0x90c7Fc0Fe4F0188E61C131d5dB7aCa03a684a2fB" // Simple7702Account Implementation 0.6
        ]
    })
}
