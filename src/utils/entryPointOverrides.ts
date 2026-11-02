import {
    type AccessList,
    type Address,
    BaseError,
    type Hex,
    type PublicClient,
    RawContractError,
    type StateOverride,
    encodeFunctionData,
    encodePacked,
    getAddress,
    getCreateAddress,
    isAddressEqual,
    keccak256,
    pad,
    slice,
    toHex
} from "viem"
import {
    type EntryPointVersion,
    entryPoint06Address,
    entryPoint07Address,
    entryPoint08Address,
    entryPoint09Address
} from "viem/account-abstraction"

import entryPointOverride06 from "../contracts/EntryPointFilterOpsOverride.sol/EntryPointFilterOpsOverride06.json" with {
    type: "json"
}
import entryPointOverride07 from "../contracts/EntryPointFilterOpsOverride.sol/EntryPointFilterOpsOverride07.json" with {
    type: "json"
}
import entryPointOverride08 from "../contracts/EntryPointFilterOpsOverride.sol/EntryPointFilterOpsOverride08.json" with {
    type: "json"
}
import entryPointOverride09 from "../contracts/EntryPointFilterOpsOverride.sol/EntryPointFilterOpsOverride09.json" with {
    type: "json"
}
import entryPointNestedHandleOpsProxy from "../contracts/NestedHandleOpsDetector.sol/EntryPointNestedHandleOpsProxy.json" with {
    type: "json"
}
import nestedHandleOpsDetector from "../contracts/NestedHandleOpsDetector.sol/NestedHandleOpsDetector.json" with {
    type: "json"
}

export const getSenderCreatorOverride = (entryPoint: Address) => {
    const slot = keccak256(toHex("SENDER_CREATOR"))
    const value = pad(
        getCreateAddress({
            from: entryPoint,
            nonce: 1n
        }),
        { size: 32 }
    )

    return {
        slot,
        value
    }
}

export const getFilterOpsStateOverride = ({
    version,
    entryPoint,
    baseFeePerGas
}: {
    version: EntryPointVersion
    entryPoint: Address
    baseFeePerGas: bigint
}): StateOverride => {
    const senderCreatorOverride = getSenderCreatorOverride(entryPoint)
    const baseFeeSlot = keccak256(toHex("BLOCK_BASE_FEE_PER_GAS"))
    const baseFeeValue = toHex(baseFeePerGas, { size: 32 })

    // Get current timestamp in seconds (block.timestamp is in seconds)
    const timestampSlot = keccak256(toHex("BLOCK_TIMESTAMP"))
    const timestampValue = toHex(Math.floor(Date.now() / 1000), { size: 32 })

    let code: Hex
    switch (version) {
        case "0.9": {
            code = entryPointOverride09.deployedBytecode.object as Hex
            break
        }
        case "0.8": {
            code = entryPointOverride08.deployedBytecode.object as Hex
            break
        }
        case "0.7": {
            code = entryPointOverride07.deployedBytecode.object as Hex
            break
        }
        default: {
            code = entryPointOverride06.deployedBytecode.object as Hex
        }
    }

    return [
        {
            address: entryPoint,
            code,
            stateDiff: [
                {
                    slot: senderCreatorOverride.slot,
                    value: senderCreatorOverride.value
                },
                {
                    slot: baseFeeSlot,
                    value: baseFeeValue
                },
                {
                    slot: timestampSlot,
                    value: timestampValue
                }
            ]
        }
    ]
}

// See contracts/src/NestedHandleOpsDetector.sol.
export const NESTED_HANDLE_OPS_DETECTOR: Address =
    "0x45F0d56b0648D7e01C656aa0cfF11252a10b7fFF"

const nestedHandleOpsDetectorOverride = {
    address: NESTED_HANDLE_OPS_DETECTOR,
    code: nestedHandleOpsDetector.deployedBytecode.object as Hex
}

// The detector uses transient storage (cancun) and PUSH0 (shanghai). Without
// them its receive always reverts and every userOp would look nested, so the
// chain is checked once.
let supportsDetectorPromise: Promise<boolean> | undefined

export const supportsNestedHandleOpsDetector = (
    publicClient: PublicClient
): Promise<boolean> => {
    if (!supportsDetectorPromise) {
        supportsDetectorPromise = publicClient
            .call({
                to: NESTED_HANDLE_OPS_DETECTOR,
                data: encodeFunctionData({
                    abi: nestedHandleOpsDetector.abi,
                    functionName: "handleOpsCalled"
                }),
                stateOverride: [nestedHandleOpsDetectorOverride]
            })
            .then(({ data }) => data !== undefined)
            .catch((err) => {
                // Only a revert means the opcodes are missing, retry on
                // anything else (e.g. a network error).
                if (
                    err instanceof BaseError &&
                    err.walk((e) => e instanceof RawContractError)
                ) {
                    return false
                }
                supportsDetectorPromise = undefined
                throw err
            })
    }
    return supportsDetectorPromise
}

// EntryPoint code never changes, so it is fetched once per EntryPoint.
const entryPointCodeCache = new Map<Address, Promise<Hex | undefined>>()

const getEntryPointCode = (
    publicClient: PublicClient,
    entryPoint: Address
): Promise<Hex | undefined> => {
    let code = entryPointCodeCache.get(entryPoint)
    if (!code) {
        code = publicClient.getCode({ address: entryPoint }).catch((err) => {
            entryPointCodeCache.delete(entryPoint)
            throw err
        })
        entryPointCodeCache.set(entryPoint, code)
    }
    return code
}

// Overrides for simulating handleOps on entryPoint with
// NESTED_HANDLE_OPS_DETECTOR as the beneficiary. Every other EntryPoint
// deployed on the chain is replaced with EntryPointNestedHandleOpsProxy, which
// runs its real code from a copy at a derived address. The proxy costs a few
// hundred gas per call, enough to run a nested handleOps out of gas when the
// userOp's gas limits are tight. The access list warms the other EntryPoints,
// saving more than that on the first call to each, along with the addresses
// only the simulation touches.
export const getNestedHandleOpsSimulation = async ({
    publicClient,
    entryPoint,
    supportedEntryPoints
}: {
    publicClient: PublicClient
    entryPoint: Address
    supportedEntryPoints: readonly Address[]
}): Promise<{ stateOverride: StateOverride; accessList: AccessList }> => {
    const otherEntryPoints = [
        ...new Set(
            [
                entryPoint06Address,
                entryPoint07Address,
                entryPoint08Address,
                entryPoint09Address,
                ...supportedEntryPoints
            ].map((address) => getAddress(address))
        )
    ].filter((address) => !isAddressEqual(address, entryPoint))

    const entryPointCodes = await Promise.all(
        otherEntryPoints.map((address) =>
            getEntryPointCode(publicClient, address)
        )
    )

    const stateOverride: StateOverride = [nestedHandleOpsDetectorOverride]
    const accessList: AccessList[number][] = [
        { address: NESTED_HANDLE_OPS_DETECTOR, storageKeys: [] }
    ]

    otherEntryPoints.forEach((address, index) => {
        const code = entryPointCodes[index]
        if (!code || code === "0x") {
            return
        }

        const implementation = getAddress(
            slice(
                keccak256(
                    encodePacked(
                        ["string", "address"],
                        ["alto.nestedHandleOps.implementation", address]
                    )
                ),
                12
            )
        )

        stateOverride.push(
            {
                address,
                code: entryPointNestedHandleOpsProxy.deployedBytecode
                    .object as Hex
            },
            { address: implementation, code }
        )
        accessList.push(
            { address, storageKeys: [] },
            { address: implementation, storageKeys: [] }
        )
    })

    return { stateOverride, accessList }
}
