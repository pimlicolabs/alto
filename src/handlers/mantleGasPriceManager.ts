import { TimedQueue } from "../utils/timedQueue"

export class MantleManager {
    private tokenRatioQueue: TimedQueue
    private scalarQueue: TimedQueue
    private rollupDataGasAndOverheadQueue: TimedQueue
    private l1GasPriceQueue: TimedQueue

    constructor(maxQueueSize: number) {
        const queueValidity = 15_000
        this.tokenRatioQueue = new TimedQueue(maxQueueSize, queueValidity)
        this.scalarQueue = new TimedQueue(maxQueueSize, queueValidity)
        this.rollupDataGasAndOverheadQueue = new TimedQueue(
            maxQueueSize,
            queueValidity
        )
        this.l1GasPriceQueue = new TimedQueue(maxQueueSize, queueValidity)
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
