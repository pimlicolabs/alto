import crypto from "node:crypto"
import type { GasPriceManager } from "@alto/handlers"
import {
    type Address,
    MantleBvmGasPriceOracleAbi,
    OpL1FeeAbi,
    type UserOperation,
    type UserOperation06,
    type UserOperation07
} from "@alto/types"
import {
    type Chain,
    type PublicClient,
    type Transport,
    bytesToHex,
    concat,
    encodeAbiParameters,
    getContract,
    maxUint64,
    maxUint128,
    maxUint256,
    parseEther,
    serializeTransaction,
    size,
    slice,
    toBytes,
    toHex
} from "viem"
import type { AltoConfig } from "../createConfig"
import { encodeHandleOpsCalldata } from "../executor/utils"
import { ArbitrumL1FeeAbi } from "../types/contracts/ArbitrumL1FeeAbi"
import {
    maxBigInt,
    minBigInt,
    randomBigInt,
    unscaleBigIntByPercent
} from "./bigInt"
import { isVersion06, isVersion07, toPackedUserOp } from "./userop"

// Encodes a user operation into bytes for gas calculation
export function encodeUserOp(userOp: UserOperation): Uint8Array {
    const p = fillUserOpWithDummyData(userOp)

    if (isVersion06(userOp)) {
        return toBytes(
            encodeAbiParameters(
                [
                    {
                        components: [
                            { name: "sender", type: "address" },
                            { name: "nonce", type: "uint256" },
                            { name: "initCode", type: "bytes" },
                            { name: "callData", type: "bytes" },
                            { name: "callGasLimit", type: "uint256" },
                            { name: "verificationGasLimit", type: "uint256" },
                            { name: "preVerificationGas", type: "uint256" },
                            { name: "maxFeePerGas", type: "uint256" },
                            { name: "maxPriorityFeePerGas", type: "uint256" },
                            { name: "paymasterAndData", type: "bytes" },
                            { name: "signature", type: "bytes" }
                        ],
                        name: "userOperation",
                        type: "tuple"
                    }
                ],
                [p as UserOperation06]
            )
        )
    }
    // For v0.7, we need to pack the user operation
    const packedOp = toPackedUserOp(p as UserOperation07)
    return toBytes(
        encodeAbiParameters(
            [
                {
                    components: [
                        { name: "sender", type: "address" },
                        { name: "nonce", type: "uint256" },
                        { name: "initCode", type: "bytes" },
                        { name: "callData", type: "bytes" },
                        { name: "accountGasLimits", type: "bytes32" },
                        { name: "preVerificationGas", type: "uint256" },
                        { name: "gasFees", type: "bytes32" },
                        { name: "paymasterAndData", type: "bytes" },
                        { name: "signature", type: "bytes" }
                    ],
                    name: "userOperation",
                    type: "tuple"
                }
            ],
            [packedOp]
        )
    )
}

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

export function fillUserOpWithDummyData(userOp: UserOperation): UserOperation {
    if (isVersion06(userOp)) {
        return {
            ...userOp,
            callGasLimit: maxUint128,
            verificationGasLimit: maxUint128,
            preVerificationGas: maxUint256,
            maxFeePerGas: maxUint128,
            maxPriorityFeePerGas: maxUint128,
            paymasterAndData: bytesToHex(
                new Uint8Array(userOp.paymasterAndData.length).fill(255)
            ),
            signature: bytesToHex(
                new Uint8Array(userOp.signature.length).fill(255)
            )
        }
    }

    // For v0.7
    const hasPaymaster = !!userOp.paymaster
    return {
        ...userOp,
        callGasLimit: maxUint128,
        verificationGasLimit: maxUint128,
        preVerificationGas: maxUint256,
        maxFeePerGas: maxUint128,
        maxPriorityFeePerGas: maxUint128,
        ...(hasPaymaster && {
            paymasterVerificationGasLimit: maxUint128,
            paymasterPostOpGasLimit: maxUint128,
            paymasterData: bytesToHex(
                new Uint8Array(size(userOp.paymasterData || "0x")).fill(255)
            )
        }),
        signature: bytesToHex(new Uint8Array(size(userOp.signature)).fill(255))
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
    const oh = { ...defaultOverHeads }
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

// Helper function to serialize transaction with default values
function serializeTxWithDefaults(txParams: any) {
    // Default values for required fields
    txParams.nonce = 999999
    txParams.gasLimit = maxUint64
    txParams.maxFeePerGas = maxUint64
    txParams.maxPriorityFeePerGas = maxUint64

    // Always use EIP-1559 transaction
    return serializeTransaction(txParams, {
        r: "0x123451234512345123451234512345123451234512345123451234512345",
        s: "0x123451234512345123451234512345123451234512345123451234512345",
        yParity: 1
    })
}

// Calculate the L2-specific gas component of preVerificationGas
export async function calcL2PvgComponent({
    config,
    userOp,
    entryPoint,
    gasPriceManager,
    validate
}: {
    config: AltoConfig
    userOp: UserOperation
    entryPoint: Address
    gasPriceManager: GasPriceManager
    validate: boolean
}): Promise<bigint> {
    let simulationUserOp = {
        ...userOp
    }

    // Add random gasFields during estimations
    if (!validate) {
        simulationUserOp = {
            ...simulationUserOp,
            callGasLimit: randomBigInt({ upper: 10_000_000n }),
            verificationGasLimit: randomBigInt({ upper: 10_000_000n }),
            preVerificationGas: randomBigInt({ upper: 10_000_000n })
        }

        if (isVersion07(simulationUserOp)) {
            simulationUserOp = {
                ...simulationUserOp,
                paymasterVerificationGasLimit: randomBigInt({
                    upper: 10_000_000n
                }),
                paymasterPostOpGasLimit: randomBigInt({
                    upper: 10_000_000n
                })
            }
        }
    }

    switch (config.chainType) {
        case "op-stack":
            return await calcOptimismPvg(
                config.publicClient,
                simulationUserOp,
                entryPoint,
                gasPriceManager,
                validate
            )
        case "arbitrum":
            return await calcArbitrumPvg(
                config.publicClient,
                simulationUserOp,
                entryPoint,
                gasPriceManager,
                validate
            )
        case "mantle":
            return await calcMantlePvg(
                config.publicClient,
                simulationUserOp,
                entryPoint,
                gasPriceManager,
                validate
            )
        case "etherlink":
            return await calcEtherlinkPvg(
                simulationUserOp,
                entryPoint,
                gasPriceManager,
                validate
            )
        default:
            return 0n
    }
}

// Returns a serialized transaction for the handleOps call
export function getSerializedHandleOpsTx({
    userOps,
    entryPoint,
    chainId,
    removeZeros = true,
    randomizeSignature = false
}: {
    userOps: UserOperation[]
    entryPoint: Address
    chainId: number
    removeZeros?: boolean
    randomizeSignature?: boolean
}) {
    if (userOps.length === 0) {
        throw new Error("No user operations provided")
    }

    // Process operations based on configuration
    let processedOps = userOps

    if (randomizeSignature) {
        processedOps = userOps.map((op) => {
            const sigLength = size(op.signature)
            let newSignature: `0x${string}`

            const randomizeBytes = (length: number) =>
                toHex(crypto.randomBytes(length).toString("hex"))

            if (sigLength < 65) {
                // For short signatures, randomize the entire thing
                newSignature = randomizeBytes(sigLength)
            } else {
                // For longer signatures, only randomize the last 65 bytes
                const originalPart = slice(op.signature, 0, sigLength - 65)
                const randomPart = randomizeBytes(65)
                newSignature = concat([originalPart, randomPart])
            }

            return {
                ...op,
                signature: newSignature
            }
        })
    }

    // Apply removeZeros logic if needed
    const finalOps = removeZeros
        ? processedOps.map((op) => fillUserOpWithDummyData(op))
        : processedOps

    const data = encodeHandleOpsCalldata({
        userOps: finalOps,
        beneficiary: entryPoint
    })

    // Prepare transaction parameters
    const txParams = {
        to: entryPoint,
        chainId,
        data
    }

    return serializeTxWithDefaults(txParams)
}

async function calcEtherlinkPvg(
    op: UserOperation,
    entryPoint: Address,
    gasPriceManager: GasPriceManager,
    verify?: boolean
) {
    const serializedTx = getSerializedHandleOpsTx({
        userOps: [op],
        entryPoint,
        chainId: 128123 // Etherlink chain ID
    })

    // Etherlink calculates the inclusion fee (data availability fee) with:
    // 0.000004 XTZ * (150 + tx.data.size() + tx.access_list.size())

    // Get the size of serialized transaction in bytes
    const dataSize = BigInt(size(serializedTx))

    const baseConstant = 150n
    const xtzRate = parseEther("0.000004")

    const inclusionFee = (baseConstant + dataSize) * xtzRate

    // Get the current gas price to convert the inclusion fee to gas units
    const maxFeePerGas = await (verify
        ? gasPriceManager.getHighestMaxFeePerGas()
        : gasPriceManager.getGasPrice().then((res) => res.maxFeePerGas))

    // Convert the inclusion fee to gas units
    const inclusionFeeInGas = inclusionFee / maxFeePerGas

    return inclusionFeeInGas
}

async function calcMantlePvg(
    publicClient: PublicClient<Transport, Chain>,
    op: UserOperation,
    entryPoint: Address,
    gasPriceManager: GasPriceManager,
    verify?: boolean
) {
    const serializedTx = getSerializedHandleOpsTx({
        userOps: [op],
        entryPoint,
        chainId: publicClient.chain.id
    })

    let tokenRatio: bigint
    let scalar: bigint
    let rollupDataGasAndOverhead: bigint
    let l1GasPrice: bigint

    const mantleManager = gasPriceManager.mantleManager

    if (verify) {
        const minValues = await mantleManager.getMinMantleOracleValues()

        tokenRatio = minValues.minTokenRatio
        scalar = minValues.minScalar
        rollupDataGasAndOverhead = minValues.minRollupDataGasAndOverhead
        l1GasPrice = minValues.minL1GasPrice
    } else {
        ;[tokenRatio, scalar, rollupDataGasAndOverhead, l1GasPrice] =
            await Promise.all([
                publicClient.readContract({
                    address: "0x420000000000000000000000000000000000000F",
                    abi: MantleBvmGasPriceOracleAbi,
                    functionName: "tokenRatio"
                }),
                publicClient.readContract({
                    address: "0x420000000000000000000000000000000000000F",
                    abi: MantleBvmGasPriceOracleAbi,
                    functionName: "scalar"
                }),
                publicClient.readContract({
                    address: "0x420000000000000000000000000000000000000F",
                    abi: MantleBvmGasPriceOracleAbi,
                    functionName: "getL1GasUsed",
                    args: [serializedTx]
                }),
                publicClient.readContract({
                    address: "0x420000000000000000000000000000000000000F",
                    abi: MantleBvmGasPriceOracleAbi,
                    functionName: "l1BaseFee"
                })
            ])

        mantleManager.saveMantleOracleValues({
            tokenRatio,
            scalar,
            rollupDataGasAndOverhead,
            l1GasPrice
        })
    }

    const mantleL1RollUpFeeDivisionFactor = 1_000_000n

    const l1RollupFee =
        (rollupDataGasAndOverhead * l1GasPrice * tokenRatio * scalar) /
        mantleL1RollUpFeeDivisionFactor

    const maxFeePerGas = await (verify
        ? gasPriceManager.getHighestMaxFeePerGas()
        : gasPriceManager.getGasPrice().then((res) => res.maxFeePerGas))
    const l2MaxFee = BigInt(maxFeePerGas)

    return l1RollupFee / l2MaxFee
}

async function calcOptimismPvg(
    publicClient: PublicClient<Transport, Chain>,
    op: UserOperation,
    entryPoint: Address,
    gasPriceManager: GasPriceManager,
    validate: boolean
) {
    const serializedTx = getSerializedHandleOpsTx({
        userOps: [op],
        entryPoint,
        chainId: publicClient.chain.id,
        removeZeros: false,
        randomizeSignature: !validate
    })

    const opGasPriceOracle = getContract({
        abi: OpL1FeeAbi,
        address: "0x420000000000000000000000000000000000000F",
        client: {
            public: publicClient
        }
    })

    const [l1Fee, baseFeePerGas] = await Promise.all([
        validate
            ? gasPriceManager.optimismManager.getMinL1Fee()
            : opGasPriceOracle.read.getL1Fee([serializedTx]),
        validate
            ? gasPriceManager.getMaxBaseFeePerGas()
            : gasPriceManager.getBaseFee()
    ])

    let l2MaxFee: bigint
    let l2PriorityFee: bigint

    if (validate) {
        l2MaxFee = await gasPriceManager.getHighestMaxFeePerGas()
        l2PriorityFee =
            baseFeePerGas +
            (await gasPriceManager.getHighestMaxPriorityFeePerGas())
    } else {
        const gasPrices = await gasPriceManager.getGasPrice()
        l2MaxFee = gasPrices.maxFeePerGas
        l2PriorityFee = baseFeePerGas + gasPrices.maxPriorityFeePerGas
    }

    const l2price = minBigInt(l2MaxFee, l2PriorityFee)

    return l1Fee / l2price
}

async function calcArbitrumPvg(
    publicClient: PublicClient<Transport, Chain | undefined>,
    op: UserOperation,
    entryPoint: Address,
    gasPriceManager: GasPriceManager,
    validate: boolean
) {
    const precompileAddress = "0x00000000000000000000000000000000000000C8"

    const serializedTx = getSerializedHandleOpsTx({
        userOps: [op],
        entryPoint,
        chainId: publicClient.chain?.id ?? 10
    })

    const arbGasPriceOracle = getContract({
        abi: ArbitrumL1FeeAbi,
        address: precompileAddress,
        client: {
            public: publicClient
        }
    })

    const { result } = await arbGasPriceOracle.simulate.gasEstimateL1Component([
        entryPoint,
        false,
        serializedTx
    ])

    let [gasForL1, l2BaseFee, l1BaseFeeEstimate] = result

    const arbitrumManager = gasPriceManager.arbitrumManager

    arbitrumManager.saveL1BaseFee(l1BaseFeeEstimate)
    arbitrumManager.saveL2BaseFee(l2BaseFee)

    if (validate) {
        const [maxL1Fee, minL1Fee, maxL2Fee] = await Promise.all([
            l1BaseFeeEstimate || arbitrumManager.getMaxL1BaseFee(),
            arbitrumManager.getMinL1BaseFee(),
            arbitrumManager.getMaxL2BaseFee()
        ])

        gasForL1 = (gasForL1 * l2BaseFee * minL1Fee) / (maxL1Fee * maxL2Fee)
    }

    return gasForL1
}
