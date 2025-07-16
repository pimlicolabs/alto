import {
    type Address,
    type Hex,
    type StateOverride,
    getCreateAddress,
    keccak256,
    pad,
    toHex
} from "viem"
import type { EntryPointVersion } from "viem/account-abstraction"

import entryPointOverride06 from "../contracts/EntryPointFilterOpsOverride.sol/EntryPointFilterOpsOverride06.json" with {
    type: "json"
}
import entryPointOverride07 from "../contracts/EntryPointFilterOpsOverride.sol/EntryPointFilterOpsOverride07.json" with {
    type: "json"
}
import entryPointOverride08 from "../contracts/EntryPointFilterOpsOverride.sol/EntryPointFilterOpsOverride08.json" with {
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
