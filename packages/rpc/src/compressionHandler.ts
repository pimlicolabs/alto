import {
    Address, PerOpInfaltorAbi, bundleBulkerAbi,
} from "@alto/types"
import { Client, getContract } from "viem"

type PerOpInflator = {
    address: Address,
    bundleBulkerIdRegistry: Record<Address, number> // id of this PerOpInflator in each BundleBulkers
}

export class CompressionHandler {
    whiteListedInflators: Address[]
    entryPointToBundleBulker: Record<Address, Address>
    perOpInflator: PerOpInflator | null

    private constructor() {
        this.whiteListedInflators = []
        this.entryPointToBundleBulker = {}
        this.perOpInflator = null
    }

    public static async createAsync(
        whiteListedBundleBulkers: Address[],
        perOpInflatorAddr: Address,
        publicClient: Client,
    ): Promise<CompressionHandler> {
        const compressionHandler = new CompressionHandler()
        const perOpInflator : PerOpInflator = {
            address: perOpInflatorAddr,
            bundleBulkerIdRegistry: {} as Record<Address, number>
        }

        for (const bb of whiteListedBundleBulkers) {
            const bundleBulker = getContract({
                address: bb,
                abi: bundleBulkerAbi,
                publicClient,
            })

            // find this BundleBulker's associated entrypoint
            const entryPoint = await bundleBulker.read.ENTRY_POINT()
            compressionHandler.entryPointToBundleBulker[entryPoint] = bundleBulker.address

            // get our perOpInflator's id for this particular bundleBulker
            const perOpInflatorId = await bundleBulker.read.inflatorToID([perOpInflatorAddr])

            if (perOpInflatorId === 0) {
                throw new Error(`can't send ops to BundleBulker ${bb}, our perOpInflator ${perOpInflatorAddr} is not registered`)
            }

            perOpInflator.bundleBulkerIdRegistry[bundleBulker.address] = perOpInflatorId
        }

        compressionHandler.perOpInflator = perOpInflator

        return compressionHandler
    }

    public getPerOpInflatorAddress(): Address | undefined {
        return this.perOpInflator?.address
    }

    public getPerOpInflatorRegisteredId(bundleBulker: Address): number | undefined {
        return this.perOpInflator?.bundleBulkerIdRegistry[bundleBulker]
    }

    public async getInflatorRegisteredId(inflator: Address, publicClient: Client): Promise<number> {
        const perOpInflator = getContract({
            address: this.perOpInflator?.address as Address,
            abi: PerOpInfaltorAbi,
            publicClient,
        })

        return await perOpInflator.read.inflatorToID([inflator])
    }
}
