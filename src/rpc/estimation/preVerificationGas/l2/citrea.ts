import type { GasPriceManager } from "@alto/handlers"
import type { Hex } from "viem"
import type { AltoConfig } from "../../../../createConfig"

// Based on: https://docs.citrea.xyz/advanced/fee-model#how-l1-fee-is-calculated
// l1_fee = l1_fee_rate × diff_size
export async function calcCitreaPvg(
    config: AltoConfig,
    gasPriceManager: GasPriceManager,
    validate: boolean
) {
    const publicClient = config.publicClient
    const l1DiffSize = config.citreaL1DiffSize

    let l1FeeRate: bigint

    if (validate) {
        l1FeeRate = await gasPriceManager.citreaManager.getMinL1FeeRate()
    } else {
        // ledger_getHeadL2Block returns the latest L2 block header which includes l1_fee_rate
        const headL2Block = (await publicClient.request({
            // @ts-ignore - custom Citrea RPC method
            method: "ledger_getHeadL2Block"
        })) as unknown as { header: { l1_fee_rate: Hex } }

        l1FeeRate = BigInt(headL2Block.header.l1_fee_rate)

        gasPriceManager.citreaManager.saveL1FeeRate(l1FeeRate)
    }

    const l1Fee = l1FeeRate * l1DiffSize

    const maxFeePerGas = validate
        ? await gasPriceManager.getHighestMaxFeePerGas()
        : (await gasPriceManager.getGasPrice()).maxFeePerGas

    // ceil(l1Fee / maxFeePerGas)
    return (l1Fee + maxFeePerGas - 1n) / maxFeePerGas
}
