import {
    http,
    type Address,
    type Hex,
    createPublicClient,
    createTestClient,
    createWalletClient
} from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { foundry } from "viem/chains"
import {
    BICONOMY_ACCOUNT_V2_LOGIC_CREATECALL,
    BICONOMY_DEFAULT_FALLBACK_HANDLER_CREATECALL,
    BICONOMY_ECDSA_OWNERSHIP_REGISTRY_MOUDULE_CREATECALL,
    BICONOMY_FACTORY_CREATECALL,
    BICONOMY_SINGLETON_FACTORY_BYTECODE,
    ENTRY_POINT_SIMULATIONS_CREATECALL,
    ENTRY_POINT_V06_CREATECALL,
    ENTRY_POINT_V07_CREATECALL,
    KERNEL_ACCOUNT_V2_2_LOGIC_CREATECALL,
    KERNEL_ECDSA_VALIDATOR_CREATECALL,
    KERNEL_FACTORY_CREATECALL,
    MULTICALL3_BYTECODE,
    SAFE_MULTI_SEND_CALL_ONLY_CREATECALL,
    SAFE_MULTI_SEND_CREATECALL,
    SAFE_PROXY_FACTORY_CREATECALL,
    SAFE_SINGLETON_CREATECALL,
    SAFE_SINGLETON_FACTORY_BYTECODE,
    SAFE_V06_MODULE_CREATECALL,
    SAFE_V06_MODULE_SETUP_CREATECALL,
    SAFE_V07_MODULE_CREATECALL,
    SAFE_V07_MODULE_SETUP_CREATECALL,
    SIMPLE_ACCOUNT_FACTORY_V06_CREATECALL,
    SIMPLE_ACCOUNT_FACTORY_V07_CREATECALL
} from "./constants"

const DETERMINISTIC_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c"
const SAFE_SINGLETON_FACTORY = "0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7"
const BICONOMY_SINGLETON_FACTORY = "0x988C135a1049Ce61730724afD342fb7C56CD2776"

const publicClient = createPublicClient({
    chain: foundry,
    transport: http("http://127.0.0.1:8545")
})

const walletClient = createWalletClient({
    account: mnemonicToAccount(
        "test test test test test test test test test test test junk"
    ),
    chain: foundry,
    transport: http("http://127.0.0.1:8545")
})

const anvilClient = createTestClient({
    transport: http("http://127.0.0.1:8545"),
    mode: "anvil"
})

const verifyDeployed = async (addresses: Address[]) => {
    for (const address of addresses) {
        const bytecode = await publicClient.getBytecode({
            address
        })

        if (bytecode === undefined) {
            // biome-ignore lint/suspicious/noConsoleLog: it is oke
            console.log(`CONTRACT ${address} NOT DEPLOYED!!!`)
            process.exit(1)
        }
    }
}

const main = async () => {
    // biome-ignore lint/suspicious/noConsoleLog: []
    console.log("========== DEPLOYING V0.7 CORE CONTRACTS ==========")

    const txs: Hex[] = []

    txs.push(
        await walletClient.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: ENTRY_POINT_V07_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed EntryPoint V0.7")

    txs.push(
        await walletClient.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SIMPLE_ACCOUNT_FACTORY_V07_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed SimpleAccountFactory v0.7")

    txs.push(
        await walletClient.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: ENTRY_POINT_SIMULATIONS_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed EntryPointSimulations")

    // biome-ignore lint/suspicious/noConsoleLog: []
    console.log("========== DEPLOYING V0.6 CORE CONTRACTS ==========")

    txs.push(
        await walletClient.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: ENTRY_POINT_V06_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed EntryPoint v0.6")

    txs.push(
        await walletClient.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SIMPLE_ACCOUNT_FACTORY_V06_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed SimpleAccountFactory v0.6")

    // biome-ignore lint/suspicious/noConsoleLog: []
    console.log("========== DEPLOYING SAFE CONTRACTS ==========")

    txs.push(
        await walletClient.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SAFE_V06_MODULE_SETUP_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed v0.6 Safe Module Setup")

    txs.push(
        await walletClient.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SAFE_V06_MODULE_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed v0.6 Safe 4337 Module")

    txs.push(
        await walletClient.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SAFE_V07_MODULE_SETUP_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed v0.7 Safe Module Setup")

    txs.push(
        await walletClient.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SAFE_V07_MODULE_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed v0.7 Safe 4337 Module")

    await anvilClient.setCode({
        address: SAFE_SINGLETON_FACTORY,
        bytecode: SAFE_SINGLETON_FACTORY_BYTECODE
    })
    console.log("Etched Safe Singleton Factory Bytecode")

    txs.push(
        await walletClient.sendTransaction({
            to: SAFE_SINGLETON_FACTORY,
            data: SAFE_PROXY_FACTORY_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed Safe Proxy Factory")

    txs.push(
        await walletClient.sendTransaction({
            to: SAFE_SINGLETON_FACTORY,
            data: SAFE_SINGLETON_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed Safe Singleton")

    txs.push(
        await walletClient.sendTransaction({
            to: SAFE_SINGLETON_FACTORY,
            data: SAFE_MULTI_SEND_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed Safe Multi Send")

    txs.push(
        await walletClient.sendTransaction({
            to: SAFE_SINGLETON_FACTORY,
            data: SAFE_MULTI_SEND_CALL_ONLY_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed Safe Multi Send Call Only")

    // biome-ignore lint/suspicious/noConsoleLog: []
    console.log("========== DEPLOYING BICONOMY CONTRACTS ==========")

    await anvilClient.setCode({
        address: BICONOMY_SINGLETON_FACTORY,
        bytecode: BICONOMY_SINGLETON_FACTORY_BYTECODE
    })
    console.log("Etched Biconomy Singleton Factory Bytecode")

    txs.push(
        await walletClient.sendTransaction({
            to: BICONOMY_SINGLETON_FACTORY,
            data: BICONOMY_ECDSA_OWNERSHIP_REGISTRY_MOUDULE_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed Biconomy ECDSA Ownership Registry Module")

    txs.push(
        await walletClient.sendTransaction({
            to: BICONOMY_SINGLETON_FACTORY,
            data: BICONOMY_ACCOUNT_V2_LOGIC_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed Biconomy Account V0.2 Logic")

    txs.push(
        await walletClient.sendTransaction({
            to: BICONOMY_SINGLETON_FACTORY,
            data: BICONOMY_FACTORY_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed Biconomy Factory")

    txs.push(
        await walletClient.sendTransaction({
            to: BICONOMY_SINGLETON_FACTORY,
            data: BICONOMY_DEFAULT_FALLBACK_HANDLER_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed Biconomy Default Fallback Handler")

    // biome-ignore lint/suspicious/noConsoleLog: []
    console.log("========== DEPLOYING KERNEL CONTRACTS ==========")

    txs.push(
        await walletClient.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: KERNEL_ECDSA_VALIDATOR_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed ECDSA Validator")

    txs.push(
        await walletClient.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: KERNEL_ACCOUNT_V2_2_LOGIC_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed Account V2 Logic")

    txs.push(
        await walletClient.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: KERNEL_FACTORY_CREATECALL,
            gas: 15_000_000n
        })
    )
    console.log("Deployed Kernel Factory")

    // biome-ignore lint/suspicious/noConsoleLog: []
    console.log("========== MISC ==========")

    await anvilClient.setCode({
        address: "0xcA11bde05977b3631167028862bE2a173976CA11",
        bytecode: MULTICALL3_BYTECODE
    })
    console.log("Etched Multicall Factory Bytecode")

    console.log("Waiting for transactions...")
    for (const hash of txs) {
        await publicClient.waitForTransactionReceipt({ hash })
    }

    console.log("Verifying deployments...")
    await verifyDeployed([
        "0x4e59b44847b379578588920ca78fbf26c0b4956c",
        "0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7",
        "0x988C135a1049Ce61730724afD342fb7C56CD2776",
        "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
        "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985",
        "0xBbe8A301FbDb2a4CD58c4A37c262ecef8f889c47",
        "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47",
        "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226",
        "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
        "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
        "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
        "0x41675C099F32341bf84BFc5382aF534df5C7461a",
        "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
        "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
        "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
        "0x9406Cc6185a346906296840746125a0E44976454",
        "0x0000001c5b32F37F5beA87BDD5374eB2aC54eA8e",
        "0x0000002512019Dafb59528B82CB92D3c5D2423ac",
        "0x000000a56Aaca3e9a4C479ea6b6CD0DbcB6634F5",
        "0x0bBa6d96BD616BedC6BFaa341742FD43c60b83C1",
        "0xd9AB5096a832b9ce79914329DAEE236f8Eea0390",
        "0x0DA6a956B9488eD4dd761E59f52FDc6c8068E6B5",
        "0x5de4839a76cf55d0c90e2061ef4386d962E15ae3",
        "0xca11bde05977b3631167028862be2a173976ca11"
    ])

    console.log("Done!")
}

main().then(() => process.exit(0))
