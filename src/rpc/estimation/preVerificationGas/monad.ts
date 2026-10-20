import { getBundleGasLimit } from "@alto/executor"
import type { Address, UserOperation } from "@alto/types"
import {
    isVersion06,
    isVersion07,
    scaleBigIntByPercent,
    unscaleBigIntByPercent
} from "@alto/utils"
import type { AltoConfig } from "../../../createConfig"

// Monad consumes the entire gasLimit set by TX. To account for this, we need to know the gasLimit
// the bundler sets for this userOp.
export async function getMonadPvg({
    userOp,
    config,
    entryPoint,
    validate
}: {
    userOp: UserOperation
    config: AltoConfig
    entryPoint: Address
    validate: boolean
}) {
    const {
        utilityWalletAddress: beneficiary,
        v6CallGasLimitMultiplier,
        v6VerificationGasLimitMultiplier,
        v7VerificationGasLimitMultiplier,
        v7PaymasterVerificationGasLimitMultiplier,
        v7CallGasLimitMultiplier,
        v7PaymasterPostOpGasLimitMultiplier
    } = config

    const bundlerGasLimit = await getBundleGasLimit({
        config,
        userOps: [userOp],
        entryPoint,
        executorAddress: beneficiary
    })

    // Calculate actual gas used by removing multipliers based on version
    let gasUsedByUserOp = 0n
    if (isVersion06(userOp)) {
        const realCallGasLimit = unscaleBigIntByPercent(
            userOp.callGasLimit,
            BigInt(v6CallGasLimitMultiplier)
        )
        const realVerificationGasLimit = unscaleBigIntByPercent(
            userOp.verificationGasLimit,
            BigInt(v6VerificationGasLimitMultiplier)
        )

        gasUsedByUserOp = realCallGasLimit + realVerificationGasLimit
    }

    if (isVersion07(userOp)) {
        const realCallGasLimit = unscaleBigIntByPercent(
            userOp.callGasLimit,
            BigInt(v7CallGasLimitMultiplier)
        )
        const realVerificationGasLimit = unscaleBigIntByPercent(
            userOp.verificationGasLimit,
            BigInt(v7VerificationGasLimitMultiplier)
        )
        const realPaymasterVerificationGasLimit = unscaleBigIntByPercent(
            userOp.paymasterVerificationGasLimit ?? 0n,
            BigInt(v7PaymasterVerificationGasLimitMultiplier)
        )
        const realPaymasterPostOpGasLimit = unscaleBigIntByPercent(
            userOp.paymasterPostOpGasLimit ?? 0n,
            BigInt(v7PaymasterPostOpGasLimitMultiplier)
        )

        gasUsedByUserOp =
            realCallGasLimit +
            realVerificationGasLimit +
            realPaymasterVerificationGasLimit +
            realPaymasterPostOpGasLimit
    }

    // Monad uses the entire tx.gasLimit.
    let burnedGas = bundlerGasLimit - scaleBigIntByPercent(gasUsedByUserOp, 70n)

    if (validate) {
        // We scale down 10% during validation to account for the variance in
        // dummy paymasterData and signature fields.
        burnedGas = scaleBigIntByPercent(burnedGas, 90n)
    }

    return burnedGas
}
