import type { GasPriceManager } from "@alto/handlers"
import {
    type Address,
    EntryPointV06Abi,
    EntryPointV07Abi,
    type PackedUserOperation,
    type UserOperation,
    type UserOperationV06,
    type UserOperationV07,
    MantleBvmGasPriceOracleAbi,
    OpL1FeeAbi
} from "@alto/types"
import {
    type Chain,
    type PublicClient,
    type Transport,
    bytesToHex,
    encodeAbiParameters,
    getContract,
    serializeTransaction,
    maxUint64,
    encodeFunctionData,
    parseGwei,
    parseEther,
    maxUint256,
    toHex,
    size,
    concat,
    slice,
    toBytes
} from "viem"
import { minBigInt, randomBigInt } from "./bigInt"
import { isVersion06, isVersion07, toPackedUserOperation } from "./userop"
import type { AltoConfig } from "../createConfig"
import { ArbitrumL1FeeAbi } from "../types/contracts/ArbitrumL1FeeAbi"
import crypto from "crypto"

export interface GasOverheads {
    perUserOp: number // per userOp overhead, added on top of the above fixed per-bundle
    zeroByte: number // zero byte cost, for calldata gas cost calculations
    nonZeroByte: number // non-zero byte cost, for calldata gas cost calculations
    bundleSize: number // expected bundle size, to split per-bundle overhead between all ops
    sigSize: number // expected length of the userOp signature
    eip7702AuthGas: number // overhead for EIP-7702 auth gas
    executeUserOpGasOverhead: number // extra per-userop overhead, if callData starts with "executeUserOp" method signature.
    executeUserOpPerWordGasOverhead: number // extra per-userop overhead, if callData starts with "executeUserOp" method signature.
    perUserOpWordGasOverhead: number // Gas overhead per single "word" (32 bytes) in callData. (all validation fields are covered by verification gas checks)
    fixedGasOverhead: number // Gas overhead is added to entire 'handleOp' bundle (on top of the transactionGasStipend).
    expectedBundleSize: number // Expected bundle size, to split per-bundle overhead between all ops
    transactionGasStipend: number // Cost of sending a basic transaction on the current chain.
    standardTokenGasCost: number
    tokensPerNonzeroByte: number
}

const defaultOverHeads: GasOverheads = {
    tokensPerNonzeroByte: 4,
    fixedGasOverhead: 9830,
    transactionGasStipend: 21000,
    perUserOp: 7260,
    standardTokenGasCost: 4,
    zeroByte: 4,
    nonZeroByte: 16,
    bundleSize: 1,
    sigSize: 65,
    eip7702AuthGas: 25000,
    executeUserOpGasOverhead: 1610,
    executeUserOpPerWordGasOverhead: 8.2,
    perUserOpWordGasOverhead: 9.2,
    expectedBundleSize: 1
}

export function fillAndPackUserOp(
    userOpearation: UserOperation
): UserOperationV06 | PackedUserOperation {
    if (isVersion06(userOpearation)) {
        return {
            sender: userOpearation.sender,
            nonce: userOpearation.nonce,
            initCode: userOpearation.initCode,
            callData: userOpearation.callData,
            callGasLimit: maxUint256,
            verificationGasLimit: maxUint256,
            preVerificationGas: maxUint256,
            maxFeePerGas: maxUint256,
            maxPriorityFeePerGas: maxUint256,
            paymasterAndData: bytesToHex(
                new Uint8Array(userOpearation.paymasterAndData.length).fill(255)
            ),
            signature: bytesToHex(
                new Uint8Array(userOpearation.signature.length).fill(255)
            )
        }
    }

    const packedUserOperation: PackedUserOperation = toPackedUserOperation(
        userOpearation as UserOperationV07
    )

    return {
        sender: packedUserOperation.sender,
        nonce: maxUint256,
        initCode: packedUserOperation.initCode,
        callData: packedUserOperation.callData,
        accountGasLimits: toHex(maxUint256),
        preVerificationGas: maxUint256,
        gasFees: toHex(maxUint256),
        paymasterAndData: bytesToHex(
            new Uint8Array(packedUserOperation.paymasterAndData.length).fill(
                255
            )
        ),
        signature: bytesToHex(
            new Uint8Array(packedUserOperation.signature.length).fill(255)
        )
    }
}

// Calculate the execution gas component of preVerificationGas
export function calcExecutionGasComponent({
    userOp,
    supportsEip7623
}: {
    userOp: UserOperation
    supportsEip7623: boolean
}): bigint {
    const oh = { ...defaultOverHeads }
    const p = fillAndPackUserOp(userOp)

    let callDataOverhead = 0
    let perUserOpOverhead = oh.perUserOp
    if (userOp.eip7702Auth) {
        perUserOpOverhead += oh.eip7702AuthGas
    }

    let packed: Uint8Array
    if (isVersion06(userOp)) {
        packed = toBytes(
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
                [p as UserOperationV06]
            )
        )
    } else {
        packed = toBytes(
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
                [p as PackedUserOperation]
            )
        )
    }

    const tokenCount = packed
        .map((x) => (x === 0 ? 1 : oh.tokensPerNonzeroByte))
        .reduce((sum, x) => sum + x)
    const userOpWordsLength = (size(packed) + 31) / 32

    // If callData starts with executeUserOp method selector
    if (slice(userOp.callData, 0, 4) === "0x8dd7712f") {
        perUserOpOverhead +=
            oh.executeUserOpGasOverhead +
            oh.executeUserOpPerWordGasOverhead * userOpWordsLength
    } else {
        callDataOverhead =
            Math.ceil(size(userOp.callData) / 32) * oh.perUserOpWordGasOverhead
    }

    const userOpSpecificOverhead = perUserOpOverhead + callDataOverhead
    const userOpShareOfBundleCost = oh.fixedGasOverhead / oh.expectedBundleSize

    const userOpShareOfStipend =
        oh.transactionGasStipend / oh.expectedBundleSize

    if (supportsEip7623) {
        return BigInt(0) // Using EIP-7623.
    } else {
        // Not using EIP-7623.
        return BigInt(
            oh.standardTokenGasCost * tokenCount +
                userOpShareOfStipend +
                userOpShareOfBundleCost +
                userOpSpecificOverhead
        )
    }
}

// Calculate the L2-specific gas component of preVerificationGas
export async function calcL2GasComponent({
    config,
    userOperation,
    entryPoint,
    gasPriceManager,
    validate
}: {
    config: AltoConfig
    userOperation: UserOperation
    entryPoint: Address
    gasPriceManager: GasPriceManager
    validate: boolean
}): Promise<bigint> {
    let simulationUserOp = {
        ...userOperation
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

// Returns back the bytes for the handleOps call
export function getHandleOpsCallData({
    userOps,
    entryPoint,
    removeZeros = true
}: {
    userOps: UserOperation[]
    entryPoint: Address
    removeZeros?: boolean
}) {
    if (userOps.length === 0) {
        throw new Error("No user operations provided")
    }

    const isV07 = isVersion07(userOps[0])

    if (isV07) {
        const processed = removeZeros
            ? (userOps.map((op) =>
                  fillAndPackUserOp(op)
              ) as PackedUserOperation[])
            : userOps.map((op) => toPackedUserOperation(op as UserOperationV07))

        return encodeFunctionData({
            abi: EntryPointV07Abi,
            functionName: "handleOps",
            args: [processed, entryPoint]
        })
    }

    const processed = removeZeros
        ? (userOps.map((op) => fillAndPackUserOp(op)) as UserOperationV06[])
        : (userOps as UserOperationV06[])

    return encodeFunctionData({
        abi: EntryPointV06Abi,
        functionName: "handleOps",
        args: [processed, entryPoint]
    })
}

async function calcEtherlinkPvg(
    op: UserOperation,
    entryPoint: Address,
    gasPriceManager: GasPriceManager,
    verify?: boolean
) {
    const data = getHandleOpsCallData({ userOps: [op], entryPoint })

    // Etherlink calculates the inclusion fee (data availability fee) with:
    // 0.000004 XTZ * (150 + tx.data.size() + tx.access_list.size())

    // Get the size of data in bytes
    const dataSize = BigInt(size(data))

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
    const data = getHandleOpsCallData({ userOps: [op], entryPoint })

    const serializedTx = serializeTransaction(
        {
            to: entryPoint,
            chainId: publicClient.chain.id,
            nonce: 999999,
            gasLimit: maxUint64,
            gasPrice: maxUint64,
            data
        },
        {
            r: "0x123451234512345123451234512345123451234512345123451234512345",
            s: "0x123451234512345123451234512345123451234512345123451234512345",
            v: 28n
        }
    )

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

function getOpStackHandleOpsCallData(
    op: UserOperation,
    entryPoint: Address,
    verify: boolean
) {
    let modifiedOp = {
        ...op
    }
    // Only randomize signature during estimations.
    if (!verify) {
        const randomizeBytes = (length: number) =>
            toHex(crypto.randomBytes(length).toString("hex"))

        const sigLength = size(op.signature)
        let newSignature: `0x${string}`

        if (sigLength < 65) {
            // For short signatures, randomize the entire thing
            newSignature = randomizeBytes(sigLength)
        } else {
            // For longer signatures, only randomize the last 65 bytes
            const originalPart = slice(op.signature, 0, sigLength - 65)
            const randomPart = randomizeBytes(65)
            newSignature = concat([originalPart, randomPart])
        }

        modifiedOp = {
            ...op,
            signature: newSignature
        }
    }

    if (isVersion07(modifiedOp)) {
        return encodeFunctionData({
            abi: EntryPointV07Abi,
            functionName: "handleOps",
            args: [[toPackedUserOperation(modifiedOp)], entryPoint]
        })
    }

    return encodeFunctionData({
        abi: EntryPointV06Abi,
        functionName: "handleOps",
        args: [[modifiedOp], entryPoint]
    })
}

async function calcOptimismPvg(
    publicClient: PublicClient<Transport, Chain>,
    op: UserOperation,
    entryPoint: Address,
    gasPriceManager: GasPriceManager,
    validate: boolean
) {
    const data = getOpStackHandleOpsCallData(op, entryPoint, validate)

    const serializedTx = serializeTransaction(
        {
            to: entryPoint,
            chainId: publicClient.chain.id,
            maxFeePerGas: parseGwei("120"),
            maxPriorityFeePerGas: parseGwei("120"),
            gas: 10_000_000n,
            data
        },
        {
            r: "0x123451234512345123451234512345123451234512345123451234512345",
            s: "0x123451234512345123451234512345123451234512345123451234512345",
            yParity: 1
        }
    )

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
    const data = getHandleOpsCallData({ userOps: [op], entryPoint })

    const precompileAddress = "0x00000000000000000000000000000000000000C8"

    const serializedTx = serializeTransaction(
        {
            to: entryPoint,
            chainId: publicClient.chain?.id ?? 10,
            nonce: 999999,
            gasLimit: maxUint64,
            gasPrice: maxUint64,
            data
        },
        {
            r: "0x123451234512345123451234512345123451234512345123451234512345",
            s: "0x123451234512345123451234512345123451234512345123451234512345",
            v: 28n
        }
    )

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
