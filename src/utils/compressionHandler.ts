import { type Address, BundleBulkerAbi, PerOpInflatorAbi } from "@alto/types"
import { type Client, type PublicClient, getContract } from "viem"

export class CompressionHandler {
    bundleBulkerAddress: Address
    perOpInflatorAddress: Address
    perOpInflatorId: number

    private constructor(
        bundleBulkerAddress: Address,
        perOpInflatorAddress: Address,
        perOpInflatorId: number
    ) {
        this.bundleBulkerAddress = bundleBulkerAddress
        this.perOpInflatorAddress = perOpInflatorAddress
        this.perOpInflatorId = perOpInflatorId
    }

    public static createAsync = async (
        bundleBulkerAddress: Address,
        perOpInflatorAddress: Address,
        publicClient: PublicClient
    ) => {
        const compressionHandler = new CompressionHandler(
            bundleBulkerAddress,
            perOpInflatorAddress,
            0
        )

        const bundleBulker = getContract({
            address: bundleBulkerAddress,
            abi: BundleBulkerAbi,
            client: {
                public: publicClient
            }
        })

        compressionHandler.perOpInflatorId =
            await bundleBulker.read.inflatorToID([perOpInflatorAddress])

        if (compressionHandler.perOpInflatorId === 0) {
            throw new Error(
                `PerOpInflator (${perOpInflatorAddress}) is not registered with BundleBulker (${bundleBulkerAddress})`
            )
        }

        return compressionHandler
    }

    public async getInflatorRegisteredId(
        inflator: Address,
        publicClient: Client
    ): Promise<number> {
        const perOpInflator = getContract({
            address: this.perOpInflatorAddress,
            abi: PerOpInflatorAbi,
            client: {
                public: publicClient
            }
        })

        return await perOpInflator.read.inflatorToID([inflator])
    }
}
