import type { UserOperation } from "@alto/types"
import {
    isVersion06,
    isVersion07,
    maxBigInt,
    unscaleBigIntByPercent
} from "@alto/utils"
import { size, slice } from "viem"
import type { AltoConfig } from "../../../createConfig"
import { encodeUserOp } from "./encodeUserOp"

export interface GasOverheads {
    perUserOp: bigint // Gas overhead per UserOperation added on top of fixed per-bundle overhead
    zeroByte: bigint // zero byte cost, for calldata gas cost calculations
    nonZeroByte: bigint // non-zero byte cost, for calldata gas cost calculations
    bundleSize: bigint // expected bundle size, to split per-bundle overhead between all ops
    sigSize: bigint // Size of dummy 'signature' parameter for estimation
    eip7702AuthGas: bigint // Gas cost of EIP-7702 authorization
    executeUserOpGasOverhead: bigint // Extra per-userop overhead if callData starts with "executeUserOp" method signature
    executeUserOpPerWordGasOverhead: bigint // Extra per-word overhead if callData starts with "executeUserOp" method signature (scaled by 1000 to avoid decimals)
    perUserOpWordGasOverhead: bigint // Gas overhead per single "word" (32 bytes) in callData (scaled by 1000 to avoid decimals)
    fixedGasOverhead: bigint // Gas overhead added to entire 'handleOp' bundle
    expectedBundleSize: bigint // Expected average bundle size in current network conditions
    transactionGasStipend: bigint // Cost of sending a basic transaction on the current chain
    standardTokenGasCost: bigint // Gas cost of a single "token" (zero byte) of the ABI-encoded UserOperation
    tokensPerNonzeroByte: bigint // Number of non-zero bytes counted as a single token (EIP-7623)
    floorPerTokenGasCost: bigint // The EIP-7623 floor gas cost of a single token
}

const defaultOverHeads: GasOverheads = {
    tokensPerNonzeroByte: 4n,
    fixedGasOverhead: 9830n,
    transactionGasStipend: 21000n,
    perUserOp: 7260n,
    standardTokenGasCost: 4n,
    zeroByte: 4n,
    nonZeroByte: 16n,
    bundleSize: 1n,
    sigSize: 65n,
    eip7702AuthGas: 25000n,
    executeUserOpGasOverhead: 1610n,
    executeUserOpPerWordGasOverhead: 8200n, // 8.2 * 1000 to avoid decimals
    perUserOpWordGasOverhead: 9200n, // 9.2 * 1000 to avoid decimals
    expectedBundleSize: 1n,
    floorPerTokenGasCost: 10n
}

function getGasOverheads(config: AltoConfig): GasOverheads {
    return {
        ...defaultOverHeads,
        transactionGasStipend: config.transactionGasStipend,
        zeroByte: config.calldataZeroByteGas,
        standardTokenGasCost: config.calldataZeroByteGas,
        nonZeroByte: config.calldataNonZeroByteGas,
        floorPerTokenGasCost: config.eip7623FloorPerTokenGas,
        tokensPerNonzeroByte: config.eip7623TokensPerNonzeroByte
    }
}

// Calculate the execution gas component of preVerificationGas
export function calcExecutionPvgComponent({
    userOp,
    supportsEip7623,
    config
}: {
    userOp: UserOperation
    supportsEip7623: boolean
    config: AltoConfig
}): bigint {
    const oh = getGasOverheads(config)
    const packed = encodeUserOp(userOp)

    const tokenCount = BigInt(
        packed
            .map((x) => (x === 0 ? 1 : Number(oh.tokensPerNonzeroByte)))
            .reduce((sum, x) => sum + x)
    )
    const userOpWordsLength = BigInt(Math.floor((size(packed) + 31) / 32))

    let callDataOverhead = 0n
    let perUserOpOverhead = oh.perUserOp
    if (userOp.eip7702Auth) {
        perUserOpOverhead += oh.eip7702AuthGas
    }

    // If callData starts with executeUserOp method selector
    if (slice(userOp.callData, 0, 4) === "0x8dd7712f") {
        perUserOpOverhead +=
            oh.executeUserOpGasOverhead +
            (oh.executeUserOpPerWordGasOverhead * userOpWordsLength) / 1000n
    } else {
        callDataOverhead =
            (BigInt(Math.ceil(size(userOp.callData) / 32)) *
                oh.perUserOpWordGasOverhead) /
            1000n
    }

    const userOpSpecificOverhead = perUserOpOverhead + callDataOverhead
    const userOpShareOfBundleCost = oh.fixedGasOverhead / oh.expectedBundleSize

    const userOpShareOfStipend =
        oh.transactionGasStipend / oh.expectedBundleSize

    if (supportsEip7623) {
        const calculatedGasUsed = getUserOpGasUsed({
            userOp,
            config
        })

        const preVerificationGas =
            getEip7623transactionGasCost({
                stipendGasCost: userOpShareOfStipend,
                tokenGasCount: tokenCount,
                oh,
                executionGasCost:
                    userOpShareOfBundleCost +
                    userOpSpecificOverhead +
                    calculatedGasUsed
            }) - calculatedGasUsed

        return preVerificationGas
    }
    // Not using EIP-7623.
    return (
        oh.standardTokenGasCost * tokenCount +
        userOpShareOfStipend +
        userOpShareOfBundleCost +
        userOpSpecificOverhead
    )
}

// Based on the formula in https://eips.ethereum.org/EIPS/eip-7623#specification
function getEip7623transactionGasCost({
    stipendGasCost,
    tokenGasCount,
    executionGasCost,
    oh
}: {
    stipendGasCost: bigint
    tokenGasCount: bigint
    executionGasCost: bigint
    oh: GasOverheads
}): bigint {
    const standardCost =
        oh.standardTokenGasCost * tokenGasCount + executionGasCost
    const floorCost = oh.floorPerTokenGasCost * tokenGasCount

    return stipendGasCost + maxBigInt(standardCost, floorCost)
}

// during validation, collect only the gas known to be paid: the actual validation and 10% of execution gas.
function getUserOpGasUsed({
    userOp,
    config
}: { userOp: UserOperation; config: AltoConfig }): bigint {
    // Extract all multipliers from config
    const {
        v6CallGasLimitMultiplier,
        v6VerificationGasLimitMultiplier,
        v7CallGasLimitMultiplier,
        v7PaymasterPostOpGasLimitMultiplier
    } = config

    if (isVersion06(userOp)) {
        const realCallGasLimit = unscaleBigIntByPercent(
            userOp.callGasLimit,
            BigInt(v6CallGasLimitMultiplier)
        )
        const realVerificationGasLimit = unscaleBigIntByPercent(
            userOp.verificationGasLimit,
            BigInt(v6VerificationGasLimitMultiplier)
        )

        return (realCallGasLimit + realVerificationGasLimit) / 10n
    }

    if (isVersion07(userOp)) {
        const realCallGasLimit = unscaleBigIntByPercent(
            userOp.callGasLimit,
            BigInt(v7CallGasLimitMultiplier)
        )
        const realPaymasterPostOpGasLimit = unscaleBigIntByPercent(
            userOp.paymasterPostOpGasLimit ?? 0n,
            BigInt(v7PaymasterPostOpGasLimitMultiplier)
        )

        return (realCallGasLimit + realPaymasterPostOpGasLimit) / 10n
    }

    throw new Error("Invalid user operation version")
}
