import type { AltoConfig } from "../createConfig"
import { type MinMaxQueue, createMinMaxQueue } from "../utils/minMaxQueue"

export class MantleManager {
    private tokenRatioQueue: MinMaxQueue
    private scalarQueue: MinMaxQueue
    private rollupDataGasAndOverheadQueue: MinMaxQueue
    private l1GasPriceQueue: MinMaxQueue

    constructor({ config }: { config: AltoConfig }) {
        this.tokenRatioQueue = createMinMaxQueue({
            keyPrefix: "token-ratio-queue",
            config
        })
        this.scalarQueue = createMinMaxQueue({
            keyPrefix: "scalar-queue",
            config
        })
        this.l1GasPriceQueue = createMinMaxQueue({
            keyPrefix: "l1-gas-price-queue",
            config
        })
        this.rollupDataGasAndOverheadQueue = createMinMaxQueue({
            keyPrefix: "rollup-data-gas-and-overhead-queue",
            config
        })
    }

    public async getMinMantleOracleValues() {
        return {
            minTokenRatio: (await this.tokenRatioQueue.getMinValue()) || 1n,
            minScalar: (await this.scalarQueue.getMinValue()) || 1n,
            minRollupDataGasAndOverhead:
                (await this.rollupDataGasAndOverheadQueue.getMinValue()) || 1n,
            minL1GasPrice: (await this.l1GasPriceQueue.getMinValue()) || 1n
        }
    }

    public saveMantleOracleValues({
        tokenRatio,
        scalar,
        rollupDataGasAndOverhead,
        l1GasPrice
    }: {
        tokenRatio: bigint
        scalar: bigint
        rollupDataGasAndOverhead: bigint
        l1GasPrice: bigint
    }) {
        this.tokenRatioQueue.saveValue(tokenRatio)
        this.scalarQueue.saveValue(scalar)
        this.rollupDataGasAndOverheadQueue.saveValue(rollupDataGasAndOverhead)
        this.l1GasPriceQueue.saveValue(l1GasPrice)
    }
}
