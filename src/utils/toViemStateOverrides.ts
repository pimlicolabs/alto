import {
    type Hex,
    type StateOverride as ViemStateOverride,
    getAddress
} from "viem"
import type { StateOverrides } from "../types/schemas"

export function toViemStateOverrides(
    stateOverrides?: StateOverrides
): ViemStateOverride {
    const result: ViemStateOverride = []

    if (!stateOverrides) {
        return result
    }

    for (const [address, override] of Object.entries(stateOverrides)) {
        // Skip if override is undefined
        if (!override) continue

        try {
            const validatedAddress = getAddress(address)
            const entry: ViemStateOverride[number] = {
                address: validatedAddress,
                balance:
                    override.balance !== undefined
                        ? override.balance
                        : undefined,
                nonce:
                    override.nonce !== undefined
                        ? Number(override.nonce)
                        : undefined,
                code: override.code
            }

            // Convert state or stateDiff from record to array format
            if (override.state) {
                entry.state = Object.entries(override.state).map(
                    ([slot, value]) => ({
                        slot: slot as Hex,
                        value: value as Hex
                    })
                )
            }

            if (override.stateDiff) {
                entry.stateDiff = Object.entries(override.stateDiff).map(
                    ([slot, value]) => ({
                        slot: slot as Hex,
                        value: value as Hex
                    })
                )
            }

            result.push(entry)
        } catch (e) {
            console.warn(`Invalid address in state override: ${address}`)
        }
    }

    return result
}
