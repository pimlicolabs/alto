import {
    type Address,
    type ChainType,
    EntryPointV06Abi,
    EntryPointV07Abi,
    type PackedUserOperation,
    type UserOperation,
    type UserOperationV06,
    type UserOperationV07
} from "@alto/types"
import {
    type Chain,
    ContractFunctionExecutionError,
    ContractFunctionRevertedError,
    EstimateGasExecutionError,
    FeeCapTooLowError,
    type Hex,
    InsufficientFundsError,
    IntrinsicGasTooLowError,
    NonceTooLowError,
    type PublicClient,
    TransactionExecutionError,
    type Transport,
    bytesToHex,
    concat,
    encodeAbiParameters,
    getAbiItem,
    getContract,
    serializeTransaction,
    toBytes,
    toFunctionSelector
} from "viem"
import { baseGoerli, baseSepolia, base } from "viem/chains"
import { isVersion06, toPackedUserOperation } from "./userop"
import { minBigInt } from "./bigInt"
import type { GasPriceManager } from "@alto/handlers"

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
            callGasLimit: BigInt(
                "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            ),
            verificationGasLimit: BigInt(
                "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            ),
            preVerificationGas: BigInt(
                "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            ),
            maxFeePerGas: BigInt(
                "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            ),
            maxPriorityFeePerGas: BigInt(
                "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            ),
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
        nonce: BigInt(
            "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
        ),
        initCode: packedUserOperation.initCode,
        callData: packedUserOperation.callData,
        accountGasLimits: bytesToHex(new Uint8Array(32).fill(255)),
        preVerificationGas: BigInt(
            "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
        ),
        gasFees: bytesToHex(new Uint8Array(32).fill(255)),
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

export async function calcPreVerificationGas(
    publicClient: PublicClient<Transport, Chain>,
    userOperation: UserOperation,
    entryPoint: Address,
    chainId: number,
    chainType: ChainType,
    gasPriceManager: GasPriceManager,
    validate: boolean, // when calculating preVerificationGas for validation
    overheads?: GasOverheads
): Promise<bigint> {
    let preVerificationGas = calcDefaultPreVerificationGas(
        userOperation,
        overheads
    )

    if (chainId === 59140) {
        // linea sepolia
        preVerificationGas *= 2n
    } else if (chainType === "op-stack") {
        preVerificationGas = await calcOptimismPreVerificationGas(
            publicClient,
            userOperation,
            entryPoint,
            preVerificationGas,
            gasPriceManager,
            validate
        )
    } else if (chainType === "arbitrum") {
        preVerificationGas = await calcArbitrumPreVerificationGas(
            publicClient,
            userOperation,
            entryPoint,
            preVerificationGas
        )
    }

    return preVerificationGas
}

export function calcVerificationGasAndCallGasLimit(
    userOperation: UserOperation,
    executionResult: {
        preOpGas: bigint
        paid: bigint
    },
    chainId: number,
    callDataResult?: {
        gasUsed: bigint
    }
) {
    const verificationGasLimit =
        ((executionResult.preOpGas - userOperation.preVerificationGas) * 3n) /
        2n

    let gasPrice: bigint

    if (userOperation.maxPriorityFeePerGas === userOperation.maxFeePerGas) {
        gasPrice = userOperation.maxFeePerGas
    } else {
        gasPrice = userOperation.maxFeePerGas
    }

    const calculatedCallGasLimit =
        callDataResult?.gasUsed ??
        executionResult.paid / gasPrice - executionResult.preOpGas

    let callGasLimit =
        (calculatedCallGasLimit > 9000n ? calculatedCallGasLimit : 9000n) +
        21000n +
        50000n

    if (
        chainId === baseGoerli.id ||
        chainId === baseSepolia.id ||
        chainId === base.id
    ) {
        callGasLimit = (110n * callGasLimit) / 100n
    }

    return { verificationGasLimit, callGasLimit }
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
    const ret = Math.round(
        callDataCost +
            ov.fixed / ov.bundleSize +
            ov.perUserOp +
            ov.perUserOpWord * lengthInWord
    )
    return BigInt(ret)
}

const maxUint64 = 2n ** 64n - 1n

const getL1FeeAbi = [
    {
        inputs: [
            {
                internalType: "bytes",
                name: "data",
                type: "bytes"
            }
        ],
        name: "getL1Fee",
        outputs: [
            {
                internalType: "uint256",
                name: "fee",
                type: "uint256"
            }
        ],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
        inputs: [],
        name: "l1BaseFee",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function"
    }
] as const

export async function calcOptimismPreVerificationGas(
    publicClient: PublicClient<Transport, Chain>,
    op: UserOperation,
    entryPoint: Address,
    staticFee: bigint,
    gasPriceManager: GasPriceManager,
    verify?: boolean
) {
    let selector: Hex
    let paramData: Hex

    if (isVersion06(op)) {
        const randomDataUserOp: UserOperation = removeZeroBytesFromUserOp(op)
        const handleOpsAbi = getAbiItem({
            abi: EntryPointV06Abi,
            name: "handleOps"
        })

        selector = toFunctionSelector(handleOpsAbi)
        paramData = encodeAbiParameters(handleOpsAbi.inputs, [
            [randomDataUserOp],
            entryPoint
        ])
    } else {
        const randomDataUserOp: PackedUserOperation =
            removeZeroBytesFromUserOp(op)

        const handleOpsAbi = getAbiItem({
            abi: EntryPointV07Abi,
            name: "handleOps"
        })

        selector = toFunctionSelector(handleOpsAbi)
        paramData = encodeAbiParameters(handleOpsAbi.inputs, [
            [randomDataUserOp],
            entryPoint
        ])
    }

    const data = concat([selector, paramData])

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

    const opGasPriceOracle = getContract({
        abi: getL1FeeAbi,
        address: "0x420000000000000000000000000000000000000F",
        client: {
            public: publicClient
        }
    })

    const { result: l1Fee } = await opGasPriceOracle.simulate.getL1Fee([
        serializedTx
    ])

    if (op.maxFeePerGas <= 1n || op.maxPriorityFeePerGas <= 1n) {
        // if user didn't provide gasPrice values, fetch current going price rate
        const gasPrices = await gasPriceManager.getGasPrice()
        op.maxPriorityFeePerGas = gasPrices.maxPriorityFeePerGas
        op.maxFeePerGas = gasPrices.maxFeePerGas
    }

    const l2MaxFee = op.maxFeePerGas

    let baseFeePerGas = 0n
    if (verify) {
        baseFeePerGas = await gasPriceManager.getMaxBaseFeePerGas()
    } else {
        baseFeePerGas = await gasPriceManager.getBaseFee()
    }
    const l2PriorityFee = baseFeePerGas + op.maxPriorityFeePerGas

    const l2price = minBigInt(l2MaxFee, l2PriorityFee)

    return staticFee + l1Fee / l2price
}

const getArbitrumL1FeeAbi = [
    {
        inputs: [
            {
                internalType: "address",
                name: "to",
                type: "address"
            },
            {
                internalType: "bool",
                name: "contractCreation",
                type: "bool"
            },
            {
                internalType: "bytes",
                name: "data",
                type: "bytes"
            }
        ],
        name: "gasEstimateL1Component",
        outputs: [
            {
                internalType: "uint64",
                name: "gasEstimateForL1",
                type: "uint64"
            },
            {
                internalType: "uint256",
                name: "baseFee",
                type: "uint256"
            },
            {
                internalType: "uint256",
                name: "l1BaseFeeEstimate",
                type: "uint256"
            }
        ],
        stateMutability: "nonpayable",
        type: "function"
    }
] as const

export async function calcArbitrumPreVerificationGas(
    publicClient: PublicClient<Transport, Chain | undefined>,
    op: UserOperation,
    entryPoint: Address,
    staticFee: bigint
) {
    let selector: Hex
    let paramData: Hex

    if (isVersion06(op)) {
        const handleOpsAbi = getAbiItem({
            abi: EntryPointV06Abi,
            name: "handleOps"
        })

        selector = toFunctionSelector(handleOpsAbi)
        paramData = encodeAbiParameters(handleOpsAbi.inputs, [
            [removeZeroBytesFromUserOp(op)],
            entryPoint
        ])
    } else {
        const randomDataUserOp: PackedUserOperation =
            removeZeroBytesFromUserOp(op)

        const handleOpsAbi = getAbiItem({
            abi: EntryPointV07Abi,
            name: "handleOps"
        })

        selector = toFunctionSelector(handleOpsAbi)
        paramData = encodeAbiParameters(handleOpsAbi.inputs, [
            [randomDataUserOp],
            entryPoint
        ])
    }

    const data = concat([selector, paramData])

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
        abi: getArbitrumL1FeeAbi,
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

    return result[0] + staticFee
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
        return
    }
    return
}
