import { Hex, concat, toHex } from "viem"
import { Address, UserOperation } from "./schemas"

// Type that knows how to encode/decode itself
export class CompressedUserOp {
    compressedCalldata: Hex
    inflatedUserOp: UserOperation
    inflatorAddr: Address
    bundleBulkerAddr: Address
    entryPointAddr: Address
    inflatorId: number // id of targetInflator in PerOpInflator
    perOpInflatorId: number // id of PerOpInflator in BundleBulker

    // ideally this type should derive id's / addresses by itself instead of taking them in as inputs
    constructor(
        compressedCalldata : Hex,
        inflatedUserOp: UserOperation,
        bundleBulkerAddr: Address,
        entryPointAddr: Address,
        inflatorAddr: Address,
        inflatorId: number,
        perOpInflatorId: number
    ) {
        this.compressedCalldata = compressedCalldata
        this.inflatedUserOp = inflatedUserOp
        this.bundleBulkerAddr = bundleBulkerAddr
        this.entryPointAddr = entryPointAddr
        this.inflatorAddr = inflatorAddr
        this.inflatorId = inflatorId
        this.perOpInflatorId = perOpInflatorId
    }

    // generates calldata that wraps compressedCalldata for forwarding to BundleBulker
    public bundleBulkerCalldata(): Hex {
        return concat([toHex(this.perOpInflatorId), this.perOpInflatorCalldata()])
    }

    // generates calldata that wraps compressedCalldata for forwarding to PerOpInflator
    perOpInflatorCalldata(): Hex {
        return concat([toHex(this.inflatorId), this.compressedCalldata])
    }
}
