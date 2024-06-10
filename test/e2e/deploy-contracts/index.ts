import {
    http,
    type Address,
    createPublicClient,
    createWalletClient,
    getContract,
    encodeAbiParameters,
    concat,
    getCreate2Address,
    sliceHex,
    parseAbi
} from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { foundry } from "viem/chains"
import {
    BUNDLER_BULKER_CREATECALL,
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

    // ==== DEPLOY COMPRESSION RELATED ==== //

    // deploy bundle bulker.
    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: BUNDLER_BULKER_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[COMPRESSION] Deploying BundleBulker"))

    // deploy per op inflator.
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

    // deploy simple inflator.
    walletClient
        .sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: SIMPLE_INFLATOR_CREATECALL,
            gas: 15_000_000n,
            nonce: nonce++
        })
        .then(() => console.log("[COMPRESSION] Deploying SimpleInflator"))

    // Wait for all deploy/setup txs to be mined.
    let onchainNonce = 0
    do {
        onchainNonce = await client.getTransactionCount({
            address: walletClient.account.address
        })
        await new Promise((resolve) => setTimeout(resolve, 500))
    } while (onchainNonce !== nonce)

    console.log("okay")

    const bundleBulkerCreateByteCode = sliceHex(
        BUNDLER_BULKER_CREATECALL,
        32,
        undefined
    )
    const BUNDLE_BULKER_ADDRESS = getCreate2Address({
        salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
        bytecode: bundleBulkerCreateByteCode,
        from: DETERMINISTIC_DEPLOYER
    })

    const perOpInflatorCreateByteCode = sliceHex(
        PER_OP_INFLATOR_CREATECALL,
        32,
        undefined
    )
    const PER_OP_INFLATOR_ADDRESS = getCreate2Address({
        salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
        bytecode: concat([
            perOpInflatorCreateByteCode,
            encodeAbiParameters(
                [{ name: "owner", type: "address" }],
                [walletClient.account.address]
            )
        ]),
        from: DETERMINISTIC_DEPLOYER
    })

    const simpleInflatorCreateByteCode = sliceHex(
        SIMPLE_INFLATOR_CREATECALL,
        32,
        undefined
    )
    const SIMPLE_INFLATOR_ADDRESS = getCreate2Address({
        salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
        bytecode: simpleInflatorCreateByteCode,
        from: DETERMINISTIC_DEPLOYER
    })

    // register our passthrough inflator with perOpInflator.
    const perOpInflator = getContract({
        address: PER_OP_INFLATOR_ADDRESS,
        abi: parseAbi([
            "function registerOpInflator(uint32 inflatorId, address inflator) public",
            "function setBeneficiary(address) public"
        ]),
        client: {
            wallet: walletClient
        }
    })

    await perOpInflator.write.registerOpInflator(
        [1337, SIMPLE_INFLATOR_ADDRESS],
        { nonce: nonce++ }
    )
    await perOpInflator.write.setBeneficiary([walletClient.account.address], {
        nonce: nonce++
    })

    // register our perOpInflator with the bundleBulker.
    const bundleBulker = getContract({
        address: BUNDLE_BULKER_ADDRESS,
        abi: parseAbi([
            "function registerInflator(uint32 inflatorId, address inflator) public"
        ]),
        client: { wallet: walletClient }
    })

    await bundleBulker.write.registerInflator([4337, PER_OP_INFLATOR_ADDRESS], {
        nonce: nonce++
    })

    await verifyDeployed([
        "0x4e59b44847b379578588920ca78fbf26c0b4956c",
        "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
        "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985",
        "0x74Cb5e4eE81b86e70f9045036a1C5477de69eE87",
        BUNDLE_BULKER_ADDRESS,
        PER_OP_INFLATOR_ADDRESS,
        SIMPLE_INFLATOR_ADDRESS
    ])
}

main()
