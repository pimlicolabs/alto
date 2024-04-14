import {
    http,
    type Address,
    createPublicClient,
    createTestClient,
    createWalletClient,
    parseEther,
    concat,
    encodeAbiParameters,
    getContract,
    parseAbi
} from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { sendTransaction } from "viem/actions"
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

const anvilClient = createTestClient({
    transport: http(process.env.ANVIL_RPC),
    mode: "anvil"
})

const client = createPublicClient({
    transport: http(process.env.ANVIL_RPC)
})

const main = async () => {
    let nonce = 0
    await anvilClient.setAutomine(true)

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

    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: concat([
                PER_OP_INFLATOR_CREATECALL,
                encodeAbiParameters(
                    [{ name: "owner", type: "address" }],
                    [walletClient.account.address]
                )
            ]),
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[COMPRESSION] Deploying PerOpInflator"))

    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SIMPLE_INFLATOR_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[COMPRESSION] Deploying SimpleInflator"))

    const BUNDLE_BULKER_ADDRESS = "0x09aeBCF1DF7d4D0FBf26073e79A6B250f458fFB8"
    const PER_OP_INFLATOR_ADDRESS = "0x79741195EA18e1ed7deD6C224e9037d673cE9484"
    const SIMPLE_INFLATOR_ADDRESS = "0x92d2f9EF7b520D91A34501FBb31E5428AB2fd5Df"

    // register our SimpleInflator with PerOpInflator.
    const perOpInflator = getContract({
        address: PER_OP_INFLATOR_ADDRESS,
        abi: parseAbi(["function registerOpInflator(uint32 inflatorId, IOpInflator inflator) public"]),
        client: {
            wallet: walletClient
        }
    })

    await perOpInflator.write.registerOpInflator([
        1337,
        SIMPLE_INFLATOR_ADDRESS
    ])

    // register our PerOpInflator with the BundleBulker.
    const bundleBulker = getContract({
        address: BUNDLE_BULKER_ADDRESS,
        abi: parseAbi(["function registerInflator(uint32 inflatorId, IInflator inflator) public"]),
        client: {
            wallet: walletClient
        }
    })

    await bundleBulker.write.registerInflator([4337, PER_OP_INFLATOR_ADDRESS])

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
