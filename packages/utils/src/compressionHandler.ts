import {
    Address, PerOpInfaltorAbi
} from "@alto/types"
import { Client, getContract } from "viem"

export class CompressionHandler {
    bundleBulkerAddress: Address
    perOpInflatorAddress: Address
    perOpInflatorId: number

    constructor(
        bundleBulkerAddress: Address,
        perOpInflatorAddress: Address,
        perOpInflatorId: number,
    ) {
        this.bundleBulkerAddress = bundleBulkerAddress
        this.perOpInflatorAddress = perOpInflatorAddress
        this.perOpInflatorId = perOpInflatorId
    }

    public async getInflatorRegisteredId(inflator: Address, publicClient: Client): Promise<number> {
        const perOpInflator = getContract({
            address: this.perOpInflatorAddress,
            abi: PerOpInfaltorAbi,
            publicClient,
        })

        return await perOpInflator.read.inflatorToID([inflator])
    }
}
