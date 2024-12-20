import { ENTRY_POINT_SIMULATIONS_CREATECALL } from "@alto/types"
import {
    type Chain,
    createWalletClient,
    type Hex,
    http,
    type PublicClient,
    type Transport
} from "viem"
import type { CamelCasedProperties } from "./parseArgs"
import type { IOptions } from "@alto/cli"

const DETERMINISTIC_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c"

export const deploySimulationsContract = async ({
    args,
    publicClient
}: {
    args: CamelCasedProperties<IOptions>
    publicClient: PublicClient<Transport, Chain>
}): Promise<Hex> => {
    const utilityPrivateKey = args.utilityPrivateKey
    if (!utilityPrivateKey) {
        throw new Error(
            "Cannot deploy entryPoint simulations without utility-private-key"
        )
    }

    if (args.entrypointSimulationContract) {
        const simulations = args.entrypointSimulationContract
        const simulationsCode = await publicClient.getCode({
            address: simulations
        })
        if (simulationsCode !== undefined && simulationsCode !== "0x") {
            return args.entrypointSimulationContract
        }
    }

    const walletClient = createWalletClient({
        transport: http(args.rpcUrl),
        account: utilityPrivateKey
    })

    const deployHash = await walletClient.sendTransaction({
        chain: publicClient.chain,
        to: DETERMINISTIC_DEPLOYER,
        data: ENTRY_POINT_SIMULATIONS_CREATECALL
    })

    const receipt = await publicClient.waitForTransactionReceipt({
        hash: deployHash
    })

    const simulationsContract = receipt.contractAddress

    if (simulationsContract === null || simulationsContract === undefined) {
        throw new Error("Failed to deploy simulationsContract")
    }

    return simulationsContract
}
