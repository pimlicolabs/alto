import type { Logger } from "@alto/utils"
import type { AltoConfig } from "../createConfig"
import { type MinMaxQueue, createMinMaxQueue } from "../utils/minMaxQueue"

export class MantleManager {
    private readonly logger: Logger
    private readonly tokenRatioQueue: MinMaxQueue
    private readonly scalarQueue: MinMaxQueue
    private readonly rollupDataGasAndOverheadQueue: MinMaxQueue
    private readonly l1GasPriceQueue: MinMaxQueue

    constructor({ config }: { config: AltoConfig }) {
        this.logger = config.getLogger(
            { module: "mantle_manager" },
            { level: config.logLevel }
        )
        this.tokenRatioQueue = createMinMaxQueue({
            queueName: "token-ratio-queue",
            config
        })
        this.scalarQueue = createMinMaxQueue({
            queueName: "scalar-queue",
            config
        })
        this.l1GasPriceQueue = createMinMaxQueue({
            queueName: "l1-gas-price-queue",
            config
        })
        this.rollupDataGasAndOverheadQueue = createMinMaxQueue({
            queueName: "rollup-data-gas-and-overhead-queue",
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
        this.tokenRatioQueue.saveValue(tokenRatio).catch((err) => {
            this.logger.error({ err }, "Failed to save token ratio")
        })
        this.scalarQueue.saveValue(scalar).catch((err) => {
            this.logger.error({ err }, "Failed to save scalar")
        })
        this.rollupDataGasAndOverheadQueue
            .saveValue(rollupDataGasAndOverhead)
            .catch((err) => {
                this.logger.error(
                    { err },
                    "Failed to save rollup data gas and overhead"
                )
            })
        this.l1GasPriceQueue.saveValue(l1GasPrice).catch((err) => {
            this.logger.error({ err }, "Failed to save L1 gas price")
        })
    }
}
