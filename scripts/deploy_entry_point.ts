import { EntryPointAbi, EntryPoint_bytecode } from "@alto/types"
import {
    http,
    createPublicClient,
    createTestClient,
    createWalletClient
} from "viem"
import { foundry } from "viem/chains"

// deploy entryPoint locally
const deployLocalEntryPoint = async (): Promise<string> => {
    const publicClient = createPublicClient({
        chain: foundry,
        transport: http("http://127.0.0.1:8545")
    })

    try {
        await publicClient.getChainId()
    } catch {
        throw new Error("anvil is not running")
    }

    const testClient = createTestClient({
        chain: foundry,
        transport: http("http://127.0.0.1:8545"),
        mode: "anvil"
    })

    const walletClient = createWalletClient({
        chain: foundry,
        transport: http("http://127.0.0.1:8545"),
        key: testClient.key
    })

    const [account0] = await walletClient.getAddresses()

    const hash = await walletClient.deployContract({
        abi: EntryPointAbi,
        account: account0,
        bytecode: EntryPoint_bytecode,
        chain: walletClient.chain
    })

    await testClient.mine({ blocks: 1 })

    const rcp = await publicClient.waitForTransactionReceipt({ hash })

    const entryPointAddress = rcp.contractAddress
    if (entryPointAddress === null) {
        throw new Error("entry point deployment failed")
    }

    console.log("entryPoint deployed", entryPointAddress)

    return entryPointAddress
}

// biome-ignore lint/style/noDefaultExport: <explanation>
export default deployLocalEntryPoint

deployLocalEntryPoint().catch((e) => {
    console.error(e)
    process.exit(1)
})
