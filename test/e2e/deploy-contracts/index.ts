import {
    http,
    type Address,
    createPublicClient,
    createTestClient,
    createWalletClient,
    parseEther
} from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { sendTransaction } from "viem/actions"
import { foundry } from "viem/chains"
import {
    ENTRY_POINT_SIMULATIONS_CREATECALL,
    ENTRY_POINT_V06_CREATECALL,
    ENTRY_POINT_V07_CREATECALL,
    SIMPLE_ACCOUNT_FACTORY_V06_CREATECALL,
    SIMPLE_ACCOUNT_FACTORY_V07_CREATECALL
} from "./constants"

const DETERMINISTIC_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c"

const verifyDeployed = async (addresses: Address[]) => {
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

const walletClient = createWalletClient({
    account: mnemonicToAccount(
        "test test test test test test test test test test test junk"
    ),
    chain: foundry,
    transport: http(process.env.ANVIL_RPC)
})

const anvilClient = createTestClient({
    transport: http(process.env.ANVIL_RPC),
    mode: "anvil"
})

const client = createPublicClient({
    transport: http(process.env.ANVIL_RPC)
})

const main = async () => {
    let nonce = 0

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
        .then(() => console.log("[V0.7 CORE] Deploying EntryPointSimulations"))

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

    let onchainNonce = 0
    do {
        onchainNonce = await client.getTransactionCount({
            address: walletClient.account.address
        })
        await new Promise((resolve) => setTimeout(resolve, 500))
    } while (onchainNonce !== nonce)

    // ==== SETUP KERNEL V0.6 CONTRACTS ==== //
    const kernelFactoryOwner = "0x9775137314fE595c943712B0b336327dfa80aE8A"
    await anvilClient.setBalance({
        address: kernelFactoryOwner,
        value: parseEther("100")
    })

    await anvilClient.impersonateAccount({
        address: kernelFactoryOwner
    })

    // register 0x0DA6a956B9488eD4dd761E59f52FDc6c8068E6B5
    await sendTransaction(walletClient, {
        account: kernelFactoryOwner,
        to: "0x5de4839a76cf55d0c90e2061ef4386d962E15ae3" /* kernel factory v0.6 */,
        data: "0xbb30a9740000000000000000000000000da6a956b9488ed4dd761e59f52fdc6c8068e6b50000000000000000000000000000000000000000000000000000000000000001" /* setImplementation(address _implementation,bool _allow) */
    })

    // register 0x6723b44Abeec4E71eBE3232BD5B455805baDD22f
    await sendTransaction(walletClient, {
        account: kernelFactoryOwner,
        to: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5" /* kernel factory v0.7 */,
        data: "0x6e7dbabb0000000000000000000000006723b44abeec4e71ebe3232bd5b455805badd22f0000000000000000000000000000000000000000000000000000000000000001"
    })

    await sendTransaction(walletClient, {
        account: kernelFactoryOwner,
        to: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5" /* kernel factory v0.7 */,
        data: "0xc7e55f3e0000000000000000000000000000000071727de22e5e9d8baf0edac6f37da0320000000000000000000000000000000000000000000000000000000000015180"
    })

    await anvilClient.stopImpersonatingAccount({
        address: kernelFactoryOwner
    })

    await verifyDeployed([
        "0x4e59b44847b379578588920ca78fbf26c0b4956c",
        "0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7",
        "0x988C135a1049Ce61730724afD342fb7C56CD2776",
        "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
        "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985",
        "0xb02456A0eC77837B22156CBA2FF53E662b326713",
    ])
}

main()
