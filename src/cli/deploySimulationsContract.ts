import {
    DETERMINISTIC_DEPLOYER_TRANSACTION,
    pimlicoEntrypointSimulationsV7DeployBytecode,
    pimlicoEntrypointSimulationsV8DeployBytecode
} from "@alto/types"
import {
    type Chain,
    createWalletClient,
    getContractAddress,
    type Hex,
    http,
    type PublicClient,
    type Transport,
    concat,
    keccak256
} from "viem"
import type { CamelCasedProperties } from "./parseArgs"
import type { IOptions } from "@alto/cli"
import type { Logger } from "pino"

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
    logger,
    args,
    publicClient
}: {
    logger: Logger
    args: CamelCasedProperties<IOptions>
    publicClient: PublicClient<Transport, Chain>
}): Promise<{
    entrypointSimulationContractV7: Hex
    entrypointSimulationContractV8: Hex
}> => {
    const utilityPrivateKey = args.utilityPrivateKey
    if (!utilityPrivateKey) {
        throw new Error(
            "Cannot deploy entryPoint simulations without utility-private-key"
        )
    }

    const salt = keccak256(utilityPrivateKey.address)

    const contractAddressV7 = getContractAddress({
        opcode: "CREATE2",
        bytecode: pimlicoEntrypointSimulationsV7DeployBytecode,
        salt,
        from: args.deterministicDeployerAddress
    })

    const contractAddressV8 = getContractAddress({
        opcode: "CREATE2",
        bytecode: pimlicoEntrypointSimulationsV8DeployBytecode,
        salt,
        from: args.deterministicDeployerAddress
    })

    const [isV7Deployed, isV8Deployed, isDeterministicDeployerDeployed] =
        await Promise.all([
            isContractDeployed({ publicClient, address: contractAddressV7 }),
            isContractDeployed({ publicClient, address: contractAddressV8 }),
            isContractDeployed({
                publicClient,
                address: args.deterministicDeployerAddress
            })
        ])

    if (isV7Deployed && isV8Deployed && isDeterministicDeployerDeployed) {
        return {
            entrypointSimulationContractV7: contractAddressV7,
            entrypointSimulationContractV8: contractAddressV8
        }
    }

    const walletClient = createWalletClient({
        transport: http(args.rpcUrl),
        account: utilityPrivateKey
    })

    if (!isDeterministicDeployerDeployed) {
        const deterministicDeployHash = await walletClient.sendRawTransaction({
            serializedTransaction: DETERMINISTIC_DEPLOYER_TRANSACTION
        })

        await publicClient.waitForTransactionReceipt({
            hash: deterministicDeployHash
        })
    }

    if (!isV7Deployed) {
        const deployHash = await walletClient.sendTransaction({
            chain: publicClient.chain,
            to: args.deterministicDeployerAddress,
            data: concat([salt, pimlicoEntrypointSimulationsV7DeployBytecode])
        })

        await publicClient.waitForTransactionReceipt({
            hash: deployHash
        })
    }

    if (!isV8Deployed) {
        try {
            const deployHash = await walletClient.sendTransaction({
                chain: publicClient.chain,
                to: args.deterministicDeployerAddress,
                data: concat([
                    salt,
                    pimlicoEntrypointSimulationsV8DeployBytecode
                ])
            })

            await publicClient.waitForTransactionReceipt({
                hash: deployHash
            })
        } catch {
            logger.error("Failed to deploy simulationsContract V8")
        }
    }

    const deployStatus = await Promise.all([
        isContractDeployed({ publicClient, address: contractAddressV7 }),
        isContractDeployed({ publicClient, address: contractAddressV8 })
    ])

    if (!deployStatus[1]) {
        logger.error("Failed to deploy simulationsContract V8")
    }

    if (deployStatus[0]) {
        return {
            entrypointSimulationContractV7: contractAddressV7,
            entrypointSimulationContractV8: contractAddressV8
        }
    }

    throw new Error("Failed to deploy simulationsContract")
}
