import { getTimedQueue, type TimedQueue } from "../utils/timedQueue"
import type { AltoConfig } from "@alto/config"

export class MantleManager {
    private tokenRatioQueue: TimedQueue
    private scalarQueue: TimedQueue
    private rollupDataGasAndOverheadQueue: TimedQueue
    private l1GasPriceQueue: TimedQueue

    constructor(config: AltoConfig) {
        this.tokenRatioQueue = getTimedQueue(config)
        this.scalarQueue = getTimedQueue(config)
        this.rollupDataGasAndOverheadQueue = getTimedQueue(config)
        this.l1GasPriceQueue = getTimedQueue(config)
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
