import type { SenderManager } from "."
import type { AltoConfig } from "../../createConfig"
import type { GasPriceManager } from "../../handlers/gasPriceManager"
import { flushStuckTransaction } from "../utils"

export const flushOnStartUp = async ({
    senderManager,
    gasPriceManager,
    config
}: {
    senderManager: SenderManager
    config: AltoConfig
    gasPriceManager: GasPriceManager
}) => {
    const logger = config.getLogger(
        { module: "flush-on-start-up" },
        { level: config.logLevel }
    )

    const allWallets = new Set(senderManager.getAllWallets())

    const utilityWallet = config.utilityPrivateKey
    if (utilityWallet) {
        allWallets.add(utilityWallet)
    }

    const wallets = Array.from(allWallets)

    let gasPrice: {
        maxFeePerGas: bigint
        maxPriorityFeePerGas: bigint
    }

    try {
        gasPrice = await gasPriceManager.tryGetNetworkGasPrice()
    } catch (e) {
        logger.error({ error: e }, "error flushing stuck transaction")
        return
    }

    const promises = wallets.map(async (wallet) => {
        try {
            await flushStuckTransaction({
                config,
                wallet,
                gasPrice: gasPrice.maxFeePerGas * 5n,
                logger
            })
        } catch (e) {
            logger.error({ error: e }, "error flushing stuck transaction")
        }
    })

    await Promise.all(promises)
}
