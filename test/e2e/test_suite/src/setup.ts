import {
    Address,
    createWalletClient,
    getContract,
    http
} from "viem"
import {
    perOpInflatorCreateCall,
    bundleBulkerCreateCall,
    entryPointCreateCall,
    simpleAccountFactoryCreateCall,
    bundleBulkerAbi,
    perOpInflatorAbi
} from "./data"
import { BUNDLE_BULKER_ADDRESS, PER_OP_INFLATOR_ADDRESS, anvilAccount, anvilEndpoint } from "./utils"
import { foundry } from "viem/chains"
import { mnemonicToAccount } from "viem/accounts"

export const setupEnvironment = async () => {
    // setup variables.
    const create2Deployer: Address = "0x4e59b44847b379578588920ca78fbf26c0b4956c"
    const walletClient = createWalletClient({
        account: anvilAccount,
        chain: foundry,
        transport: http(anvilEndpoint)
    })

    // deploy entrypoint.
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: create2Deployer,
        data: entryPointCreateCall,
        chain: foundry,
    })

    // deploy simple account factory.
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: create2Deployer,
        data: simpleAccountFactoryCreateCall,
        chain: foundry,
    })

    // deploy bundle bulker.
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: create2Deployer,
        data: bundleBulkerCreateCall,
        chain: foundry,
    })

    // deploy per op inflator.
    await walletClient.sendTransaction({
        account: anvilAccount,
        to: create2Deployer,
        data: perOpInflatorCreateCall(anvilAccount.address),
        chain: foundry,
    })

    // deploy simple passthrough inflator.


    // register our passthrough inflator with perOpInflator.
    const perOpInflator = getContract({
        address: PER_OP_INFLATOR_ADDRESS,
        abi: perOpInflatorAbi,
        walletClient
    })

    await perOpInflator.write.setBeneficiary([anvilAccount.address])

    // register our perOpInflator with the bundleBulker.
    const bundleBulker = getContract({
        address: BUNDLE_BULKER_ADDRESS,
        abi: bundleBulkerAbi,
        walletClient
    })

    await bundleBulker.write.registerInflator([4337, PER_OP_INFLATOR_ADDRESS])
}
