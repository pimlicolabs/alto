import type { IOptions } from "@alto/cli"
import {
    DETERMINISTIC_DEPLOYER_TRANSACTION,
    pimlicoEntrypointSimulationsDeployBytecode,
    pimlicoEntrypointSimulationsSalt
} from "@alto/types"
import {
    http,
    type Chain,
    type Hex,
    type PublicClient,
    type Transport,
    concat,
    createWalletClient,
    getContractAddress
} from "viem"
import type { CamelCasedProperties } from "./parseArgs"

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

    // if (args.entrypointSimulationContract) {
    //     if (
    //         await isContractDeployed({
    //             publicClient,
    //             address: args.entrypointSimulationContract
    //         })
    //     ) {
    //         return args.entrypointSimulationContract
    //     }
    // }

    const walletClient = createWalletClient({
        transport: http(args.rpcUrl),
        account: utilityPrivateKey
    })

    if (
        !(await isContractDeployed({
            publicClient,
            address: args.deterministicDeployerAddress
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
        bytecode: pimlicoEntrypointSimulationsDeployBytecode,
        salt: pimlicoEntrypointSimulationsSalt,
        from: args.deterministicDeployerAddress
    })

    if (await isContractDeployed({ publicClient, address: contractAddress })) {
        return contractAddress
    }

    const deployHash = await walletClient.sendTransaction({
        chain: publicClient.chain,
        to: args.deterministicDeployerAddress,
        data: concat([
            pimlicoEntrypointSimulationsSalt,
            pimlicoEntrypointSimulationsDeployBytecode
        ])
    })

    await publicClient.waitForTransactionReceipt({
        hash: deployHash
    })

    if (await isContractDeployed({ publicClient, address: contractAddress })) {
        return contractAddress
    }

    throw new Error("Failed to deploy simulationsContract")
}
