import {
    concat,
    createWalletClient,
    encodeAbiParameters,
    getContract,
    http
} from "viem"
import {
    perOpInflatorCreateBytecode,
    bundleBulkerCreateBytecode,
    entryPointCreateBytecode,
    simpleAccountFactoryCreateBytecode,
    bundleBulkerAbi,
    perOpInflatorAbi,
    simpleInflatorCreateBytecode,
} from "../src/data"
import {
    BUNDLE_BULKER_ADDRESS,
    CREATE2_DEPLOYER_ADDRESS,
    SIMPLE_INFLATOR_ADDRESS,
    PER_OP_INFLATOR_ADDRESS,
    anvilAccount,
    anvilEndpoint,
} from "../src/utils"
import { foundry } from "viem/chains"

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
        chain: foundry,
    })

    // deploy per op inflator.
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: CREATE2_DEPLOYER_ADDRESS,
        data: concat([
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            perOpInflatorCreateBytecode,
            encodeAbiParameters([{ name: 'owner', type: 'address' }], [anvilAccount.address])
        ]),
        chain: foundry,
    })

    // deploy simple inflator.
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: CREATE2_DEPLOYER_ADDRESS,
        data: concat([
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            simpleInflatorCreateBytecode
        ]),
        chain: foundry,
    })

    // register our passthrough inflator with perOpInflator.
    const perOpInflator = getContract({
        address: PER_OP_INFLATOR_ADDRESS,
        abi: perOpInflatorAbi,
        walletClient
    })

    await perOpInflator.write.registerOpInflator([1337, SIMPLE_INFLATOR_ADDRESS])
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
    // deploy entrypoint.
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: CREATE2_DEPLOYER_ADDRESS,
        data: concat([
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            entryPointCreateBytecode
        ]),
        chain: foundry,
    })

    // deploy simple account factory.
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: CREATE2_DEPLOYER_ADDRESS,
        data: concat([
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            simpleAccountFactoryCreateBytecode
        ]),
        chain: foundry,
    })
}


(async () => {
    await setupBasicEnvironment()
    await setupCompressedEnvironment()
})()
