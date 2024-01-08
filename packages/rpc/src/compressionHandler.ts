import {
    Address, PerOpInfaltorAbi, bundleBulkerAbi,
} from "@alto/types"
import { Client, getContract } from "viem"

export class CompressionHandler {
    perOpInflatorAddress: Address
    perOpInflatorId: number
    bundleBulkerAddress: Address

    private constructor() {
        this.perOpInflatorAddress = "0x00"
        this.perOpInflatorId = 0
        this.bundleBulkerAddress = "0x00"
    }

    public static async createAsync(
        bundleBulkerAddress: Address,
        perOpInflatorAddress: Address,
        publicClient: Client,
    ): Promise<CompressionHandler> {
        const compressionHandler = new CompressionHandler()

        const bundleBulker = getContract({
            address: bundleBulkerAddress,
            abi: bundleBulkerAbi,
            publicClient,
        })

        // get our perOpInflator's id for this particular bundleBulker
        const perOpInflatorId = await bundleBulker.read.inflatorToID([perOpInflatorAddress])

        if (perOpInflatorId === 0) {
            throw new Error(`perOpInflator ${perOpInflatorAddress} is not registered with BundleBulker`)
        }

        compressionHandler.bundleBulkerAddress = bundleBulkerAddress
        compressionHandler.perOpInflatorAddress = perOpInflatorAddress
        compressionHandler.perOpInflatorId = perOpInflatorId

        return compressionHandler
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
