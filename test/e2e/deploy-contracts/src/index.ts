import {
    http,
    type Address,
    createPublicClient,
    createTestClient,
    createWalletClient,
    concat,
    encodeAbiParameters,
    getContract,
    parseAbi,
    encodeFunctionData,
    parseEther
} from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { foundry } from "viem/chains"
import {
    BUNDLE_BULKER_CREATECALL,
    ENTRY_POINT_SIMULATIONS_CREATECALL,
    ENTRY_POINT_V06_CREATECALL,
    ENTRY_POINT_V07_CREATECALL,
    PER_OP_INFLATOR_CREATECALL,
    SIMPLE_ACCOUNT_FACTORY_V06_CREATECALL,
    SIMPLE_ACCOUNT_FACTORY_V07_CREATECALL,
    SIMPLE_INFLATOR_CREATECALL
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

const client = createPublicClient({
    transport: http(process.env.ANVIL_RPC)
})

const anvilClient = createTestClient({
    transport: http(process.env.ANVIL_RPC),
    mode: "anvil"
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

    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: BUNDLE_BULKER_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[COMPRESSION] Deploying BundleBulker"))

    await walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: PER_OP_INFLATOR_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[COMPRESSION] Deploying PerOpInflator"))

    await walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SIMPLE_INFLATOR_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[COMPRESSION] Deploying SimpleInflator"))


    const BUNDLE_BULKER_ADDRESS = "0x000000000091a1f34f51ce866bed8983db51a97e"
    const PER_OP_INFLATOR_ADDRESS = "0x0000000000DD00D61091435B84D1371A1000de9a"
    const SIMPLE_INFLATOR_ADDRESS = "0x564c7dC50f8293d070F490Fc31fEc3A0A091b9bB"

    await anvilClient.setBalance({
        address: "0x433704c40f80cbff02e86fd36bc8bac5e31eb0c1",
        value: parseEther("69")
    })

    await anvilClient.impersonateAccount({
        address: "0x433704c40f80cbff02e86fd36bc8bac5e31eb0c1"
    })

    // register our SimpleInflator with PerOpInflator.
    await walletClient.sendTransaction({
        account: "0x433704c40f80cbff02e86fd36bc8bac5e31eb0c1",
        to: PER_OP_INFLATOR_ADDRESS,
        data: encodeFunctionData({
            abi: parseAbi(["function registerOpInflator(uint32 inflatorId, address inflator)"]),
            functionName: "registerOpInflator",
            args: [1337, SIMPLE_INFLATOR_ADDRESS]
        }),
        nonce: 0,
        gas: 15_000_000n,
    }).then((hash) => console.log(`Registered ${hash}`))

    await anvilClient.stopImpersonatingAccount({
        address: "0x433704c40f80cbff02e86fd36bc8bac5e31eb0c1"
    })


    // register our PerOpInflator with the BundleBulker.
    await walletClient.sendTransaction({
        to: BUNDLE_BULKER_ADDRESS,
        data: encodeFunctionData({
            abi: parseAbi(["function registerInflator(uint32 inflatorId, address inflator)"]),
            functionName: "registerInflator",
            args: [4337, PER_OP_INFLATOR_ADDRESS]
        }),
        nonce: nonce++,
        gas: 15_000_000n,
    })

    let onchainNonce = 0;
    do {
        onchainNonce = await client.getTransactionCount({ address: walletClient.account.address })
        await new Promise((resolve) => setTimeout(resolve, 500))
    } while (onchainNonce != nonce)

    await verifyDeployed([
        "0x4e59b44847b379578588920ca78fbf26c0b4956c", /* deterministic deployer */
        "0x0000000071727De22E5E9d8BAf0edAc6f37da032", /* entrypoint v0.7 */
        "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985", /* simple account factory v0.7 */
        "0xb02456A0eC77837B22156CBA2FF53E662b326713", /* entrypoint simulations */
        "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", /* entrypoint v0.6 */
        "0x9406Cc6185a346906296840746125a0E44976454", /* simple account factory v0.6 */
        BUNDLE_BULKER_ADDRESS,
        PER_OP_INFLATOR_ADDRESS,
        SIMPLE_INFLATOR_ADDRESS
    ])
}

main()
