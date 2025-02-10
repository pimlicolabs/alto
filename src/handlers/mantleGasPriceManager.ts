import { MinMaxQueue } from "../utils/slidingWindowTimedQueue"

export class MantleManager {
    private tokenRatioQueue: MinMaxQueue
    private scalarQueue: MinMaxQueue
    private rollupDataGasAndOverheadQueue: MinMaxQueue
    private l1GasPriceQueue: MinMaxQueue

    constructor(queueValidity: number) {
        this.tokenRatioQueue = new MinMaxQueue(queueValidity)
        this.scalarQueue = new MinMaxQueue(queueValidity)
        this.l1GasPriceQueue = new MinMaxQueue(queueValidity)
        this.rollupDataGasAndOverheadQueue = new MinMaxQueue(queueValidity)
    }

    public getMinMantleOracleValues() {
        return {
            minTokenRatio: this.tokenRatioQueue.getMinValue() || 1n,
            minScalar: this.scalarQueue.getMinValue() || 1n,
            minRollupDataGasAndOverhead:
                this.rollupDataGasAndOverheadQueue.getMinValue() || 1n,
            minL1GasPrice: this.l1GasPriceQueue.getMinValue() || 1n
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
