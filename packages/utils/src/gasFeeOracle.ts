import { ChainId } from '@alto/types'
import { PublicClient } from 'viem';

export class GasFeeOracle {
    publicClient: PublicClient
    constructor(
        publicClient: PublicClient,
    ) {
        this.publicClient = publicClient
    }


    getGasStationUrl(chainId: ChainId.Polygon | ChainId.Mumbai): string {
        switch (chainId) {
            case ChainId.Polygon:
                return "https://gasstation-mainnet.matic.network/v2";
            case ChainId.Mumbai:
                return "https://gasstation-mumbai.matic.today/v2";
        }
    }

    getDefaultGasFee(
        chainId: ChainId.Polygon | ChainId.Mumbai,
    ): bigint {
        switch (chainId) {
            case ChainId.Polygon:
                return 31n * 1_000_000_000n;
            case ChainId.Mumbai:
                return 1n * 1_000_000_000n;
        }
    }

    async getPolygonGasPriorityFee(
        chainId: ChainId.Polygon | ChainId.Mumbai,
    ): Promise<bigint> {
        const gasStationUrl = this.getGasStationUrl(chainId);
        try {
            const data = await (await fetch(gasStationUrl)).json();
            const priorityFee = data["standard"]["maxPriorityFee"];
            if (priorityFee > 0) {
                const fixedFee = BigInt(parseFloat(priorityFee) * 1_000_000_000);
                return fixedFee;
            }
        } catch (error) {
            console.error("failed to fetch gas", error);
        }
        return this.getDefaultGasFee(chainId);
    }

    async getFee(chainId: ChainId | undefined): Promise<bigint> {
        switch (chainId) {
            case ChainId.Polygon:
                return this.getPolygonGasPriorityFee(chainId)
            case undefined:
                throw new Error("undefined chain Id")
            default:
                return this.publicClient.getGasPrice()
        }
    }

}