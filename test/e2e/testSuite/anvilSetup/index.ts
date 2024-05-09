import {
    http,
    concat,
    createWalletClient,
    encodeAbiParameters,
    getContract
} from "viem"
import { foundry } from "viem/chains"
import {
    bundleBulkerAbi,
    bundleBulkerCreateBytecode,
    entryPointCreateBytecode,
    entryPointSimulationCreateBytecode,
    entryPointV07CreateBytecode,
    perOpInflatorAbi,
    perOpInflatorCreateBytecode,
    simpleAccountFactoryCreateBytecode,
    simpleInflatorCreateBytecode,
    simulateAccountFactoryV07CreateBytecode
} from "../src/data"
import {
    BUNDLE_BULKER_ADDRESS,
    CREATE2_DEPLOYER_ADDRESS,
    PER_OP_INFLATOR_ADDRESS,
    SIMPLE_INFLATOR_ADDRESS,
    anvilAccount,
    anvilEndpoint
} from "../src/utils"

const walletClient = createWalletClient({
    account: anvilAccount,
    chain: foundry,
    transport: http(anvilEndpoint)
})

const setupCompressedEnvironment = async () => {
    // deploy bundle bulker.
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: CREATE2_DEPLOYER_ADDRESS,
        data: concat([
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            bundleBulkerCreateBytecode
        ]),
        chain: foundry
    })

    // deploy per op inflator.
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: CREATE2_DEPLOYER_ADDRESS,
        data: concat([
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            perOpInflatorCreateBytecode,
            encodeAbiParameters(
                [{ name: "owner", type: "address" }],
                [anvilAccount.address]
            )
        ]),
        chain: foundry
    })

    // deploy simple inflator.
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: CREATE2_DEPLOYER_ADDRESS,
        data: concat([
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            simpleInflatorCreateBytecode
        ]),
        chain: foundry
    })

    // register our passthrough inflator with perOpInflator.
    const perOpInflator = getContract({
        address: PER_OP_INFLATOR_ADDRESS,
        abi: perOpInflatorAbi,
        walletClient
    })

    await perOpInflator.write.registerOpInflator([
        1337,
        SIMPLE_INFLATOR_ADDRESS
    ])
    await perOpInflator.write.setBeneficiary([anvilAccount.address])

    // register our perOpInflator with the bundleBulker.
    const bundleBulker = getContract({
        address: BUNDLE_BULKER_ADDRESS,
        abi: bundleBulkerAbi,
        walletClient
    })

    await bundleBulker.write.registerInflator([4337, PER_OP_INFLATOR_ADDRESS])
}

const setupBasicEnvironment = async () => {
    // deploy entrypoint v0.6
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: CREATE2_DEPLOYER_ADDRESS,
        data: concat([
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            entryPointCreateBytecode
        ]),
        chain: foundry
    })

    // deploy simple account factory v0.6
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: CREATE2_DEPLOYER_ADDRESS,
        data: concat([
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            simpleAccountFactoryCreateBytecode
        ]),
        chain: foundry
    })

    // deploy entrypoint v0.7
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: CREATE2_DEPLOYER_ADDRESS,
        data: concat([
            "0x90d8084deab30c2a37c45e8d47f49f2f7965183cb6990a98943ef94940681de3",
            entryPointV07CreateBytecode
        ]),
        chain: foundry
    })

    // deploy entrypoint v0.7 simulation contract
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: CREATE2_DEPLOYER_ADDRESS,
        data: concat([
            "0x3132333400000000000000000000000000000000000000000000000000000000",
            entryPointSimulationCreateBytecode
        ]),
        chain: foundry
    })

    // deploy simple account factory v0.7
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: CREATE2_DEPLOYER_ADDRESS,
        data: concat([
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            simulateAccountFactoryV07CreateBytecode
        ]),
        chain: foundry
    })
}
    ; (async () => {
        await setupBasicEnvironment()
        await setupCompressedEnvironment()
    })()
