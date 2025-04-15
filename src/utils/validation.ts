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
    ContractFunctionExecutionError,
    ContractFunctionRevertedError,
    EstimateGasExecutionError,
    FeeCapTooLowError,
    InsufficientFundsError,
    IntrinsicGasTooLowError,
    NonceTooLowError,
    type PublicClient,
    TransactionExecutionError,
    type Transport,
    bytesToHex,
    encodeAbiParameters,
    getContract,
    serializeTransaction,
    toBytes,
    InternalRpcError,
    maxUint64,
    encodeFunctionData,
    parseGwei,
    maxUint256,
    toHex,
    size,
    concat,
    slice
} from "viem"
import { maxBigInt, minBigInt, scaleBigIntByPercent } from "./bigInt"
import { isVersion06, isVersion07, toPackedUserOperation } from "./userop"
import type { AltoConfig } from "../createConfig"
import { ArbitrumL1FeeAbi } from "../types/contracts/ArbitrumL1FeeAbi"
import crypto from "crypto"

export interface GasOverheads {
    /**
     * fixed overhead for entire handleOp bundle.
     */
    fixed: number

    /**
     * per userOp overhead, added on top of the above fixed per-bundle.
     */
    perUserOp: number

    /**
     * overhead for userOp word (32 bytes) block
     */
    perUserOpWord: number

    // perCallDataWord: number

    /**
     * zero byte cost, for calldata gas cost calculations
     */
    zeroByte: number

    /**
     * non-zero byte cost, for calldata gas cost calculations
     */
    nonZeroByte: number

    /**
     * expected bundle size, to split per-bundle overhead between all ops.
     */
    bundleSize: number

    /**
     * expected length of the userOp signature.
     */
    sigSize: number
}

export const DefaultGasOverheads: GasOverheads = {
    fixed: 21000,
    perUserOp: 18300,
    perUserOpWord: 4,
    zeroByte: 4,
    nonZeroByte: 16,
    bundleSize: 1,
    sigSize: 65
}

/**
 * pack the userOperation
 * @param op
 *  "false" to pack entire UserOp, for calculating the calldata cost of putting it on-chain.
 */
export function packUserOpV06(op: UserOperationV06): `0x${string}` {
    return encodeAbiParameters(
        [
            {
                internalType: "address",
                name: "sender",
                type: "address"
            },
            {
                internalType: "uint256",
                name: "nonce",
                type: "uint256"
            },
            {
                internalType: "bytes",
                name: "initCode",
                type: "bytes"
            },
            {
                internalType: "bytes",
                name: "callData",
                type: "bytes"
            },
            {
                internalType: "uint256",
                name: "callGasLimit",
                type: "uint256"
            },
            {
                internalType: "uint256",
                name: "verificationGasLimit",
                type: "uint256"
            },
            {
                internalType: "uint256",
                name: "preVerificationGas",
                type: "uint256"
            },
            {
                internalType: "uint256",
                name: "maxFeePerGas",
                type: "uint256"
            },
            {
                internalType: "uint256",
                name: "maxPriorityFeePerGas",
                type: "uint256"
            },
            {
                internalType: "bytes",
                name: "paymasterAndData",
                type: "bytes"
            },
            {
                internalType: "bytes",
                name: "signature",
                type: "bytes"
            }
        ],
        [
            op.sender,
            BigInt(
                "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            ),
            op.initCode,
            op.callData,
            BigInt(
                "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            ),
            BigInt(
                "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            ),
            BigInt(
                "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            ),
            BigInt(
                "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            ),
            BigInt(
                "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            ),
            bytesToHex(new Uint8Array(op.paymasterAndData.length).fill(255)),
            bytesToHex(new Uint8Array(op.signature.length).fill(255))
        ]
    )
}

export function removeZeroBytesFromUserOp<T extends UserOperation>(
    userOpearation: T
): T extends UserOperationV06 ? UserOperationV06 : PackedUserOperation {
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
        } as T extends UserOperationV06 ? UserOperationV06 : PackedUserOperation
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
    } as T extends UserOperationV06 ? UserOperationV06 : PackedUserOperation
}

export function packUserOpV07(op: PackedUserOperation): `0x${string}` {
    return encodeAbiParameters(
        [
            {
                internalType: "address",
                name: "sender",
                type: "address"
            },
            {
                internalType: "uint256",
                name: "nonce",
                type: "uint256"
            },
            {
                internalType: "bytes",
                name: "initCode",
                type: "bytes"
            },
            {
                internalType: "bytes",
                name: "callData",
                type: "bytes"
            },
            {
                internalType: "uint256",
                name: "accountGasLimits",
                type: "bytes32"
            },
            {
                internalType: "uint256",
                name: "preVerificationGas",
                type: "uint256"
            },
            {
                internalType: "uint256",
                name: "gasFees",
                type: "bytes32"
            },
            {
                internalType: "bytes",
                name: "paymasterAndData",
                type: "bytes"
            },
            {
                internalType: "bytes",
                name: "signature",
                type: "bytes"
            }
        ],
        [
            op.sender,
            op.nonce, // need non zero bytes to get better estimations for preVerificationGas
            op.initCode,
            op.callData,
            op.accountGasLimits, // need non zero bytes to get better estimations for preVerificationGas
            op.preVerificationGas, // need non zero bytes to get better estimations for preVerificationGas
            op.gasFees, // need non zero bytes to get better estimations for preVerificationGas
            op.paymasterAndData,
            op.signature
        ]
    )
}

export async function calcPreVerificationGas({
    config,
    userOperation,
    entryPoint,
    gasPriceManager,
    validate,
    overheads
}: {
    config: AltoConfig
    userOperation: UserOperation
    entryPoint: Address
    gasPriceManager: GasPriceManager
    validate: boolean // when calculating preVerificationGas for validation
    overheads?: GasOverheads
}): Promise<bigint> {
    let preVerificationGas = calcDefaultPreVerificationGas(
        userOperation,
        overheads
    )

    switch (config.chainType) {
        case "op-stack":
            return await calcOptimismPreVerificationGas(
                config.publicClient,
                userOperation,
                entryPoint,
                preVerificationGas,
                gasPriceManager,
                validate
            )
        case "arbitrum":
            return await calcArbitrumPreVerificationGas(
                config.publicClient,
                userOperation,
                entryPoint,
                preVerificationGas,
                gasPriceManager,
                validate
            )
        case "mantle":
            return await calcMantlePreVerificationGas(
                config.publicClient,
                userOperation,
                entryPoint,
                preVerificationGas,
                gasPriceManager,
                validate
            )
        default:
            return preVerificationGas
    }
}

export function calcVerificationGasAndCallGasLimit(
    userOperation: UserOperation,
    executionResult: {
        preOpGas: bigint
        paid: bigint
    },
    gasLimits?: {
        callGasLimit?: bigint
        verificationGasLimit?: bigint
        paymasterVerificationGasLimit?: bigint
    }
) {
    const verificationGasLimit =
        gasLimits?.verificationGasLimit ??
        scaleBigIntByPercent(
            executionResult.preOpGas - userOperation.preVerificationGas,
            150n
        )

    const calculatedCallGasLimit =
        gasLimits?.callGasLimit ??
        executionResult.paid / userOperation.maxFeePerGas -
            executionResult.preOpGas

    let callGasLimit = maxBigInt(calculatedCallGasLimit, 9000n)

    if (isVersion06(userOperation)) {
        callGasLimit += 21_000n + 50_000n
    }

    return {
        verificationGasLimit,
        callGasLimit,
        paymasterVerificationGasLimit:
            gasLimits?.paymasterVerificationGasLimit ?? 0n
    }
}

/**
 * calculate the preVerificationGas of the given UserOperation
 * preVerificationGas (by definition) is the cost overhead that can't be calculated on-chain.
 * it is based on parameters that are defined by the Ethereum protocol for external transactions.
 * @param userOp filled userOp to calculate. The only possible missing fields can be the signature and preVerificationGas itself
 * @param overheads gas overheads to use, to override the default values
 */
export function calcDefaultPreVerificationGas(
    userOperation: UserOperation,
    overheads?: Partial<GasOverheads>
): bigint {
    const ov = { ...DefaultGasOverheads, ...(overheads ?? {}) }

    const p: UserOperationV06 | PackedUserOperation =
        removeZeroBytesFromUserOp(userOperation)

    let packed: Uint8Array

    if (isVersion06(userOperation)) {
        packed = toBytes(packUserOpV06(p as UserOperationV06))
    } else {
        packed = toBytes(packUserOpV07(p as PackedUserOperation))
    }

    const lengthInWord = (packed.length + 31) / 32
    const callDataCost = packed
        .map((x) => (x === 0 ? ov.zeroByte : ov.nonZeroByte))
        .reduce((sum, x) => sum + x)

    const authorizationCost = userOperation.eip7702Auth
        ? 37500 // overhead for PER_EMPTY_ACCOUNT_COST + PER_AUTH_BASE_COST
        : 0

    const ret = Math.round(
        authorizationCost +
            callDataCost +
            ov.fixed / ov.bundleSize +
            ov.perUserOp +
            ov.perUserOpWord * lengthInWord
    )
    return BigInt(ret)
}

// Returns back the bytes for the handleOps call
function getHandleOpsCallData(op: UserOperation, entryPoint: Address) {
    if (isVersion07(op)) {
        return encodeFunctionData({
            abi: EntryPointV07Abi,
            functionName: "handleOps",
            args: [[removeZeroBytesFromUserOp(op)], entryPoint]
        })
    }
    return encodeFunctionData({
        abi: EntryPointV06Abi,
        functionName: "handleOps",
        args: [[removeZeroBytesFromUserOp(op)], entryPoint]
    })
}

export async function calcMantlePreVerificationGas(
    publicClient: PublicClient<Transport, Chain>,
    op: UserOperation,
    entryPoint: Address,
    staticFee: bigint,
    gasPriceManager: GasPriceManager,
    verify?: boolean
) {
    const data = getHandleOpsCallData(op, entryPoint)

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

    return staticFee + l1RollupFee / l2MaxFee
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

export async function calcOptimismPreVerificationGas(
    publicClient: PublicClient<Transport, Chain>,
    op: UserOperation,
    entryPoint: Address,
    staticFee: bigint,
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

    return staticFee + l1Fee / l2price
}

export async function calcArbitrumPreVerificationGas(
    publicClient: PublicClient<Transport, Chain | undefined>,
    op: UserOperation,
    entryPoint: Address,
    staticFee: bigint,
    gasPriceManager: GasPriceManager,
    validate: boolean
) {
    const data = getHandleOpsCallData(op, entryPoint)

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

    return staticFee + gasForL1
}

export function parseViemError(err: unknown) {
    if (
        err instanceof ContractFunctionExecutionError ||
        err instanceof TransactionExecutionError
    ) {
        const e = err.cause
        if (e instanceof NonceTooLowError) {
            return e
        }
        if (e instanceof FeeCapTooLowError) {
            return e
        }
        if (e instanceof InsufficientFundsError) {
            return e
        }
        if (e instanceof IntrinsicGasTooLowError) {
            return e
        }
        if (e instanceof ContractFunctionRevertedError) {
            return e
        }
        if (e instanceof EstimateGasExecutionError) {
            return e
        }
        if (e instanceof InternalRpcError) {
            return e
        }
        return
    }
    return
}
