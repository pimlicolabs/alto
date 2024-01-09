import {
    Address, PerOpInfaltorAbi, BundleBulkerAbi,
} from "@alto/types"
import { Client, getContract } from "viem"

export class CompressionHandler {
    bundleBulkerAddress: Address
    perOpInflatorAddress: Address
    perOpInflatorId: number

    constructor(
        bundleBulkerAddress: Address,
        perOpInflatorAddress: Address,
    ) {
        this.bundleBulkerAddress = bundleBulkerAddress
        this.perOpInflatorAddress = perOpInflatorAddress
        this.perOpInflatorId = 0
    }

    public async fetchPerOpInflatorId(
        publicClient: Client,
    ) {
        const bundleBulker = getContract({
            address: this.bundleBulkerAddress,
            abi: BundleBulkerAbi,
            publicClient,
        })

        // get our perOpInflator's id for this particular bundleBulker
        const perOpInflatorId = await bundleBulker.read.inflatorToID([this.perOpInflatorAddress])

        if (perOpInflatorId === 0) {
            throw new Error(`perOpInflator ${this.perOpInflatorAddress} is not registered with BundleBulker`)
        }

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
