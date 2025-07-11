import type { IOptions } from "@alto/cli"
import type { Logger } from "pino"
import {
    http,
    type Chain,
    type Hex,
    type PublicClient,
    type Transport,
    concat,
    createWalletClient,
    getContractAddress,
    keccak256
} from "viem"
import entrypointSimulationsJsonV7 from "../contracts/EntryPointSimulations.sol/EntryPointSimulations07.json" with {
    type: "json"
}
import entrypointSimulationsJsonV8 from "../contracts/EntryPointSimulations.sol/EntryPointSimulations08.json" with {
    type: "json"
}
import pimlicoSimulationsJson from "../contracts/PimlicoSimulations.sol/PimlicoSimulations.json" with {
    type: "json"
}
import type { CamelCasedProperties } from "./parseArgs"

export const DETERMINISTIC_DEPLOYER_TRANSACTION =
    "0xf8a58V85174876e80V830186aV8V80b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600V81602V82378035828234f58015156039578182fd5b8V82525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222"

const isContractDeployed = async ({
    publicClient,
    address
}: {
    publicClient: PublicClient<Transport, Chain>
    address: Hex
}) => {
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
    pimlicoSimulationContract: Hex
}> => {
    const utilityPrivateKey = args.utilityPrivateKey
    if (!utilityPrivateKey) {
        throw new Error(
            "Cannot deploy entryPoint simulations without utility-private-key"
        )
    }

    const salt = keccak256(utilityPrivateKey.address)

    const pimlicoSimulations = getContractAddress({
        opcode: "CREATE2",
        bytecode: pimlicoSimulationsJson.bytecode.object as Hex,
        salt,
        from: args.deterministicDeployerAddress
    })

    const epSimulationsV7 = getContractAddress({
        opcode: "CREATE2",
        bytecode: entrypointSimulationsJsonV7.bytecode.object as Hex,
        salt,
        from: args.deterministicDeployerAddress
    })

    const epSimulationsV8 = getContractAddress({
        opcode: "CREATE2",
        bytecode: entrypointSimulationsJsonV8.bytecode.object as Hex,
        salt,
        from: args.deterministicDeployerAddress
    })

    const [
        isPimlicoDeployed,
        isDeployedV7,
        isDeployedV8,
        isDeterministicDeployerDeployed
    ] = await Promise.all([
        isContractDeployed({ publicClient, address: pimlicoSimulations }),
        isContractDeployed({ publicClient, address: epSimulationsV7 }),
        isContractDeployed({ publicClient, address: epSimulationsV8 }),
        isContractDeployed({
            publicClient,
            address: args.deterministicDeployerAddress
        })
    ])

    if (
        isDeployedV7 &&
        isDeployedV8 &&
        isPimlicoDeployed &&
        isDeterministicDeployerDeployed
    ) {
        return {
            pimlicoSimulationContract: pimlicoSimulations,
            entrypointSimulationContractV7: epSimulationsV7,
            entrypointSimulationContractV8: epSimulationsV8
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

    if (!isPimlicoDeployed) {
        try {
            const deployHash = await walletClient.sendTransaction({
                chain: publicClient.chain,
                to: args.deterministicDeployerAddress,
                data: concat([
                    salt,
                    pimlicoSimulationsJson.bytecode.object as Hex
                ])
            })

            await publicClient.waitForTransactionReceipt({
                hash: deployHash
            })
        } catch {
            logger.error("Failed to deploy PimlicoSimulations contract")
        }
    }

    if (!isDeployedV7) {
        const deployHash = await walletClient.sendTransaction({
            chain: publicClient.chain,
            to: args.deterministicDeployerAddress,
            data: concat([
                salt,
                entrypointSimulationsJsonV7.bytecode.object as Hex
            ])
        })

        await publicClient.waitForTransactionReceipt({
            hash: deployHash
        })
    }

    if (!isDeployedV8) {
        try {
            const deployHash = await walletClient.sendTransaction({
                chain: publicClient.chain,
                to: args.deterministicDeployerAddress,
                data: concat([
                    salt,
                    entrypointSimulationsJsonV8.bytecode.object as Hex
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
        isContractDeployed({ publicClient, address: pimlicoSimulations }),
        isContractDeployed({ publicClient, address: epSimulationsV7 }),
        isContractDeployed({ publicClient, address: epSimulationsV8 })
    ])

    // EntryPointSimulationsV8 is optional as not all chains support cancun.
    if (!deployStatus[1]) {
        logger.error("Failed to deploy simulationsContract V8")
    }

    if (deployStatus[0]) {
        return {
            entrypointSimulationContractV7: epSimulationsV7,
            entrypointSimulationContractV8: epSimulationsV8,
            pimlicoSimulationContract: pimlicoSimulations
        }
    }

    throw new Error("Failed to deploy simulationsContract")
}
