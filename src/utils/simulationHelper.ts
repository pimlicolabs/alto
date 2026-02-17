import { type Address, type Hex, type StateOverride } from "viem"
import type { EntryPointVersion } from "viem/account-abstraction"
import entrypointSimulationsJsonV7 from "../contracts/EntryPointSimulations.sol/EntryPointSimulations07.json" with {
    type: "json"
}
import entrypointSimulationsJsonV8 from "../contracts/EntryPointSimulations.sol/EntryPointSimulations08.json" with {
    type: "json"
}
import entrypointSimulationsJsonV9 from "../contracts/EntryPointSimulations.sol/EntryPointSimulations09.json" with {
    type: "json"
}
import pimlicoSimulationsJson from "../contracts/PimlicoSimulations.sol/PimlicoSimulations.json" with {
    type: "json"
}
import { privateKeyToAddress, generatePrivateKey } from "viem/accounts"
import type { AltoConfig } from "../createConfig"

type LocalSimulationContracts = {
    pimlicoSimulationAddress: Address
    entryPointSimulationAddress: Address
    stateOverride: StateOverride
}

type SimulationArgs = {
    pimlicoSimulationAddress: Address
    entryPointSimulationAddress?: Address
    stateOverride?: StateOverride
}

type LocalSimulationOverride = {
    address: Address
    code: Hex
}

const getEntryPointSimulationCode = (
    version: EntryPointVersion
): LocalSimulationOverride => {
    const address = privateKeyToAddress(generatePrivateKey())

    switch (version) {
        case "0.9":
            return {
                address,
                code: entrypointSimulationsJsonV9.deployedBytecode.object as Hex
            }
        case "0.8":
            return {
                address,
                code: entrypointSimulationsJsonV8.deployedBytecode.object as Hex
            }
        case "0.7":
            return {
                address,
                code: entrypointSimulationsJsonV7.deployedBytecode.object as Hex
            }
        default:
            throw new Error(
                `No local EntryPoint simulation bytecode for version ${version}`
            )
    }
}

const getConfiguredEntryPointSimulationAddress = ({
    version,
    config
}: {
    version: Exclude<EntryPointVersion, "0.6">
    config: AltoConfig
}): Address => {
    let entryPointSimulationAddress: Address | undefined

    switch (version) {
        case "0.9":
            entryPointSimulationAddress = config.entrypointSimulationContractV9
            break
        case "0.8":
            entryPointSimulationAddress = config.entrypointSimulationContractV8
            break
        case "0.7":
            entryPointSimulationAddress = config.entrypointSimulationContractV7
            break
    }

    if (!entryPointSimulationAddress) {
        throw new Error(
            `Cannot find entryPointSimulations Address for version ${version}`
        )
    }

    return entryPointSimulationAddress
}

export function getLocalPimlicoSimulationOverride(): LocalSimulationOverride {
    return {
        address: privateKeyToAddress(generatePrivateKey()),
        code: pimlicoSimulationsJson.deployedBytecode.object as Hex
    }
}

export function getLocalSimulationContracts({
    version
}: {
    version: EntryPointVersion
}): LocalSimulationContracts {
    const pimlicoSimulationOverride = getLocalPimlicoSimulationOverride()
    const entryPointSimulationOverride = getEntryPointSimulationCode(version)

    const stateOverride: StateOverride = [
        pimlicoSimulationOverride,
        entryPointSimulationOverride
    ]

    return {
        pimlicoSimulationAddress: pimlicoSimulationOverride.address,
        entryPointSimulationAddress: entryPointSimulationOverride.address,
        stateOverride
    }
}

export function getSimulationArgs({
    version,
    config
}: {
    version: EntryPointVersion
    config: AltoConfig
}): SimulationArgs {
    if (config.useSimulationOverrides) {
        if (version === "0.6") {
            const pimlicoSimulationOverride =
                getLocalPimlicoSimulationOverride()
            return {
                pimlicoSimulationAddress: pimlicoSimulationOverride.address,
                stateOverride: [pimlicoSimulationOverride]
            }
        }

        const simulationOverrides = getLocalSimulationContracts({ version })
        return {
            pimlicoSimulationAddress:
                simulationOverrides.pimlicoSimulationAddress,
            entryPointSimulationAddress:
                simulationOverrides.entryPointSimulationAddress,
            stateOverride: simulationOverrides.stateOverride
        }
    }

    if (!config.pimlicoSimulationContract) {
        throw new Error("pimlicoSimulationContract not set")
    }

    if (version === "0.6") {
        return {
            pimlicoSimulationAddress: config.pimlicoSimulationContract
        }
    }

    const entryPointSimulationAddress =
        getConfiguredEntryPointSimulationAddress({
            version,
            config
        })

    return {
        pimlicoSimulationAddress: config.pimlicoSimulationContract,
        entryPointSimulationAddress
    }
}

export const mergeViemStateOverrides = (
    ...overrides: (StateOverride | undefined)[]
): StateOverride | undefined => {
    const merged = overrides.flatMap((override) => override ?? [])
    return merged.length > 0 ? merged : undefined
}
