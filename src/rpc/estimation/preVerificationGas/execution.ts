import type { UserOperation } from "@alto/types"
import {
    hasPaymaster,
    isVersion06,
    isVersion07,
    maxBigInt,
    unscaleBigIntByPercent
} from "@alto/utils"
import { type Address, parseAbi, size, slice, zeroAddress } from "viem"
import type { AltoConfig } from "../../../createConfig"
import {
    EIP2780_ACCOUNT_WRITE,
    EIP2780_EXECUTION_PER_AUTH_BASE_COST,
    EIP8037_AUTH_BASE_STATE_GAS,
    EIP8037_NEW_ACCOUNT_STATE_GAS,
    getEip7702AuthAddress
} from "../../../utils/eip7702"
import { EIP8037_NEW_SLOT_STATE_GAS } from "../../../utils/eip8037"
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
        floorPerTokenGasCost: config.supportsEip7976
            ? config.eip7976FloorPerTokenGas
            : config.eip7623FloorPerTokenGas,
        tokensPerNonzeroByte: config.eip7623TokensPerNonzeroByte
    }
}

// The part of an EIP-7702 authorization's cost that doesn't depend on the
// authority's state
function getEip7702AuthGas({
    userOp,
    config
}: {
    userOp: UserOperation
    config: AltoConfig
}): bigint {
    if (!userOp.eip7702Auth) {
        return 0n
    }

    if (!config.supportsEip2780) {
        return defaultOverHeads.eip7702AuthGas
    }

    // The authority is never tx.sender or tx.to of the bundle, so the first
    // write to it is always charged
    return EIP2780_EXECUTION_PER_AUTH_BASE_COST + EIP2780_ACCOUNT_WRITE
}

// Under EIP-2780, creating the authority's account and setting a new
// delegation indicator are charged as EIP-8037 state gas
async function getEip7702AuthStateGas({
    userOp,
    config
}: {
    userOp: UserOperation
    config: AltoConfig
}): Promise<bigint> {
    if (!userOp.eip7702Auth || !config.supportsEip2780) {
        return 0n
    }

    const { publicClient } = config
    const setsDelegation =
        getEip7702AuthAddress(userOp.eip7702Auth) !== zeroAddress

    // validateEip7702Auth checks the auth nonce against the onchain nonce, so
    // we can use it instead of an RPC call. Deploying a contract or setting a
    // delegation bumps the nonce.

    // Zero nonce: the authority has no code, so it isn't delegated and exists
    // only if it holds a balance
    if (userOp.eip7702Auth.nonce === 0) {
        const balance = await publicClient.getBalance({
            address: userOp.sender
        })

        let stateGas = 0n

        if (balance === 0n) {
            stateGas += EIP8037_NEW_ACCOUNT_STATE_GAS
        }

        if (setsDelegation) {
            stateGas += EIP8037_AUTH_BASE_STATE_GAS
        }

        return stateGas
    }

    // Non-zero nonce: the authority exists, but may already be delegated, in
    // which case no new delegation indicator is created
    if (!setsDelegation) {
        return 0n
    }

    const code = await publicClient.getCode({ address: userOp.sender })
    const isDelegated =
        code !== undefined && size(code) > 0 && slice(code, 0, 3) === "0xef0100"

    return isDelegated ? 0n : EIP8037_AUTH_BASE_STATE_GAS
}

// The EntryPoint refunds unused prefund into the refund address's deposit
// after the userOp's gas cost is fixed, so that write is never charged to the
// userOp. Under EIP-8037, if the deposit slot was empty when the bundle
// started, the refund creates it and costs new-slot state gas. Validation
// creating and clearing the same slot refills gasleft() and doesn't offset it.
async function getEip8037RefundDepositGas({
    userOp,
    entryPoint,
    config
}: {
    userOp: UserOperation
    entryPoint: Address
    config: AltoConfig
}): Promise<bigint> {
    if (!config.supportsEip8037) {
        return 0n
    }

    // The refund goes to the paymaster's deposit, which must already cover
    // the prefund
    if (hasPaymaster(userOp)) {
        return 0n
    }

    // TODO: remove this RPC call, the simulation can return the sender's
    // deposit at the start of the userOp
    const deposit = await config.publicClient.readContract({
        address: entryPoint,
        abi: parseAbi([
            "function balanceOf(address account) view returns (uint256)"
        ]),
        functionName: "balanceOf",
        args: [userOp.sender]
    })

    // Restoring a slot that wasn't empty at the start of the bundle doesn't
    // create state
    if (deposit > 0n) {
        return 0n
    }

    return EIP8037_NEW_SLOT_STATE_GAS
}

// EIP-8037 state gas the userOp is charged, which depends on onchain state
export async function calcEip8037StatePvgComponent({
    userOp,
    entryPoint,
    config
}: {
    userOp: UserOperation
    entryPoint: Address
    config: AltoConfig
}): Promise<bigint> {
    const [eip7702AuthStateGas, refundDepositStateGas] = await Promise.all([
        getEip7702AuthStateGas({ userOp, config }),
        getEip8037RefundDepositGas({ userOp, entryPoint, config })
    ])
    return eip7702AuthStateGas + refundDepositStateGas
}

// Calculate the execution gas component of preVerificationGas
export function calcExecutionPvgComponent({
    userOp,
    config,
    eip8037StatePvgComponent
}: {
    userOp: UserOperation
    config: AltoConfig
    eip8037StatePvgComponent: bigint
}): bigint {
    const oh = getGasOverheads(config)
    const packed = encodeUserOp(userOp)

    const tokenCount = BigInt(
        packed
            .map((x) => (x === 0 ? 1 : Number(oh.tokensPerNonzeroByte)))
            .reduce((sum, x) => sum + x)
    )
    // EIP-7976 counts zero and non-zero bytes alike towards the floor
    const floorTokenCount = config.supportsEip7976
        ? BigInt(packed.length) * oh.tokensPerNonzeroByte
        : tokenCount
    const userOpWordsLength = BigInt(Math.floor((size(packed) + 31) / 32))

    let callDataOverhead = 0n
    let perUserOpOverhead =
        oh.perUserOp +
        getEip7702AuthGas({ userOp, config }) +
        eip8037StatePvgComponent

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

    if (config.supportsEip7623 || config.supportsEip7976) {
        const calculatedGasUsed = getUserOpGasUsed({
            userOp,
            config
        })

        const preVerificationGas =
            getEip7623transactionGasCost({
                stipendGasCost: userOpShareOfStipend,
                tokenGasCount: tokenCount,
                floorTokenCount,
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
// and https://eips.ethereum.org/EIPS/eip-7976#specification
function getEip7623transactionGasCost({
    stipendGasCost,
    tokenGasCount,
    floorTokenCount,
    executionGasCost,
    oh
}: {
    stipendGasCost: bigint
    tokenGasCount: bigint
    floorTokenCount: bigint
    executionGasCost: bigint
    oh: GasOverheads
}): bigint {
    const standardCost =
        oh.standardTokenGasCost * tokenGasCount + executionGasCost
    const floorCost = oh.floorPerTokenGasCost * floorTokenCount

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
