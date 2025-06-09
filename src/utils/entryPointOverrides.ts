import { EntryPointVersion } from "viem/account-abstraction"
import {
    Address,
    Hex,
    StateOverride,
    getCreateAddress,
    keccak256,
    pad,
    toHex
} from "viem"

import entryPointOverride06 from "../contracts/EntryPointCodeOverride06.sol/EntryPointCodeOverride06.json" with {
    type: "json"
}
import entryPointOverride07 from "../contracts/EntryPointCodeOverride07.sol/EntryPointCodeOverride07.json" with {
    type: "json"
}
import entryPointOverride08 from "../contracts/EntryPointCodeOverride08.sol/EntryPointCodeOverride08.json" with {
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

export const getBlockBaseFeeOverride = (baseFee: bigint) => {
    const slot = keccak256(toHex("BLOCK_BASE_FEE_PER_GAS"))
    const padded = toHex(baseFee, { size: 32 })

    return {
        slot,
        value: padded
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
    const blockBaseFeeOverride = getBlockBaseFeeOverride(baseFeePerGas)

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
                    slot: blockBaseFeeOverride.slot,
                    value: blockBaseFeeOverride.value
                }
            ]
        }
    ]
}
