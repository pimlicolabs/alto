import {
    Address,
    createWalletClient,
    http
} from "viem"
import {
    mnemonicToAccount
} from "viem/accounts"
import {
    foundry
} from "viem/chains"
import { entryPointCreateCall, simpleAccountFactoryCreateCall } from "./data"
import { anvilEndpoint } from "./utils"

export const setupEnvironment = async () => {
    // setup variables.
    const create2Deployer: Address = "0x4e59b44847b379578588920ca78fbf26c0b4956c"
    const anvilAccounts = mnemonicToAccount("test test test test test test test test test test test junk")
    const walletClient = createWalletClient({
        account: anvilAccounts,
        chain: foundry,
        transport: http(anvilEndpoint)
    })

    // deploy entrypoint.
    await walletClient.sendTransaction({
        account: anvilAccounts,
        to: create2Deployer,
        data: entryPointCreateCall,
        chain: foundry,
    })

    // deploy simple account factory.
    await walletClient.sendTransaction({
        account: anvilAccounts,
        to: create2Deployer,
        data: simpleAccountFactoryCreateCall,
        chain: foundry,
    })
}
