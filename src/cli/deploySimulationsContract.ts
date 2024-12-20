import {
    DETERMINISTIC_DEPLOYER_TRANSACTION,
    ENTRY_POINT_SIMULATIONS_CREATECALL,
    PimlicoEntryPointSimulationsDeployBytecode
} from "@alto/types"
import {
    type Chain,
    createWalletClient,
    getContractAddress,
    type Hex,
    http,
    type PublicClient,
    type Transport
} from "viem"
import type { CamelCasedProperties } from "./parseArgs"
import type { IOptions } from "@alto/cli"

const DETERMINISTIC_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c"

const isContractDeployed = async ({
    publicClient,
    address
}: { publicClient: PublicClient<Transport, Chain>; address: Hex }) => {
    const code = await publicClient.getCode({
        address
    })
    return code !== undefined && code !== "0x"
}

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
        if (
            await isContractDeployed({
                publicClient,
                address: args.entrypointSimulationContract
            })
        ) {
            return args.entrypointSimulationContract
        }
    }

    const walletClient = createWalletClient({
        transport: http(args.rpcUrl),
        account: utilityPrivateKey
    })

    if (
        !(await isContractDeployed({
            publicClient,
            address: DETERMINISTIC_DEPLOYER
        }))
    ) {
        const deterministicDeployHash = await walletClient.sendRawTransaction({
            serializedTransaction: DETERMINISTIC_DEPLOYER_TRANSACTION
        })

        await publicClient.waitForTransactionReceipt({
            hash: deterministicDeployHash
        })
    }

    const contractAddress = getContractAddress({
        opcode: "CREATE2",
        bytecode: PimlicoEntryPointSimulationsDeployBytecode,
        from: DETERMINISTIC_DEPLOYER,
        salt: "0x3132333400000000000000000000000000000000000000000000000000000000" as Hex
    })

    if (await isContractDeployed({ publicClient, address: contractAddress })) {
        return contractAddress
    }

    const deployHash = await walletClient.sendTransaction({
        chain: publicClient.chain,
        to: DETERMINISTIC_DEPLOYER,
        data: ENTRY_POINT_SIMULATIONS_CREATECALL
    })

    await publicClient.waitForTransactionReceipt({
        hash: deployHash
    })

    if (await isContractDeployed({ publicClient, address: contractAddress })) {
        return contractAddress
    }

    throw new Error("Failed to deploy simulationsContract")
}
