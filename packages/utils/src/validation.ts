import {
    EntryPointAbi,
    RpcError,
    type Address,
    type UserOperation
} from "@alto/types"
import {
    ContractFunctionExecutionError,
    ContractFunctionRevertedError,
    EstimateGasExecutionError,
    FeeCapTooLowError,
    InsufficientFundsError,
    IntrinsicGasTooLowError,
    NonceTooLowError,
    TransactionExecutionError,
    concat,
    encodeAbiParameters,
    getContract,
    getFunctionSelector,
    serializeTransaction,
    toBytes,
    toHex,
    type Chain,
    type PublicClient,
    type Transport
} from "viem"
import * as chains from "viem/chains"
import { getGasPrice, type Logger } from "."

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
export function packUserOp(op: UserOperation): `0x${string}` {
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
            op.nonce,
            op.initCode,
            op.callData,
            op.callGasLimit,
            op.verificationGasLimit,
            op.preVerificationGas,
            op.maxFeePerGas,
            op.maxPriorityFeePerGas,
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
    logger: Logger,
    overheads?: GasOverheads
): Promise<bigint> {
    let preVerificationGas = calcDefaultPreVerificationGas(
        userOperation,
        overheads
    )

    if (chainId === 59140 || chainId === 59142) {
        preVerificationGas *= 2n
    } else if (
        chainId === chains.optimism.id ||
        chainId === chains.optimismSepolia.id ||
        chainId === chains.optimismGoerli.id ||
        chainId === chains.base.id ||
        chainId === chains.baseGoerli.id ||
        chainId === chains.baseSepolia.id ||
        chainId === chains.opBNB.id ||
        chainId === chains.opBNBTestnet.id ||
        chainId === 957 // Lyra chain
    ) {
        preVerificationGas = await calcOptimismPreVerificationGas(
            publicClient,
            userOperation,
            entryPoint,
            preVerificationGas,
            logger
        )
    } else if (chainId === chains.arbitrum.id) {
        preVerificationGas = await calcArbitrumPreVerificationGas(
            publicClient,
            userOperation,
            entryPoint,
            preVerificationGas
        )
    }

    return preVerificationGas
}

export async function calcVerificationGasAndCallGasLimit(
    publicClient: PublicClient<Transport, Chain>,
    userOperation: UserOperation,
    executionResult: {
        preOpGas: bigint
        paid: bigint
    },
    chainId: number
) {
    const verificationGasLimit =
        ((executionResult.preOpGas - userOperation.preVerificationGas) * 3n) /
        2n

    let gasPrice: bigint

    if (userOperation.maxPriorityFeePerGas === userOperation.maxFeePerGas) {
        gasPrice = userOperation.maxFeePerGas
    } else {
        const blockBaseFee = (await publicClient.getBlock()).baseFeePerGas
        gasPrice =
            userOperation.maxFeePerGas <
            (blockBaseFee ?? 0n) + userOperation.maxPriorityFeePerGas
                ? userOperation.maxFeePerGas
                : userOperation.maxPriorityFeePerGas + (blockBaseFee ?? 0n)
    }
    const calculatedCallGasLimit =
        executionResult.paid / gasPrice -
        executionResult.preOpGas +
        21000n +
        50000n

    let callGasLimit =
        calculatedCallGasLimit > 9000n ? calculatedCallGasLimit : 9000n

    if (chainId === chains.baseGoerli.id || 
        chainId === chains.baseSepolia.id ||
        chainId === chains.base.id) {
        callGasLimit = (110n * callGasLimit) / 100n
    }

    return [verificationGasLimit, callGasLimit]
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

    const p = userOperation
    p.preVerificationGas ?? 21000n // dummy value, just for calldata cost
    p.signature =
        p.signature === "0x" ? toHex(Buffer.alloc(ov.sigSize, 1)) : p.signature // dummy signature

    const packed = toBytes(packUserOp(p))
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
    }
] as const

export async function calcOptimismPreVerificationGas(
    publicClient: PublicClient<Transport, Chain>,
    op: UserOperation,
    entryPoint: Address,
    staticFee: bigint,
    logger: Logger
) {
    const randomDataUserOp: UserOperation = {
        ...op
    }

    const selector = getFunctionSelector(EntryPointAbi[27])
    const paramData = encodeAbiParameters(EntryPointAbi[27].inputs, [
        [randomDataUserOp],
        entryPoint
    ])
    const data = concat([selector, paramData])

    const latestBlock = await publicClient.getBlock()
    if (latestBlock.baseFeePerGas === null) {
        throw new RpcError("block does not have baseFeePerGas")
    }

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
        publicClient
    })

    const { result: l1Fee } = await opGasPriceOracle.simulate.getL1Fee([
        serializedTx
    ])

    const gasPrice = await getGasPrice(
        publicClient.chain,
        publicClient,
        true,
        logger
    )

    const l2MaxFee = gasPrice.maxFeePerGas
    const l2PriorityFee =
        latestBlock.baseFeePerGas + gasPrice.maxPriorityFeePerGas

    const l2price = l2MaxFee < l2PriorityFee ? l2MaxFee : l2PriorityFee

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
    const selector = getFunctionSelector(EntryPointAbi[27])
    const paramData = encodeAbiParameters(EntryPointAbi[27].inputs, [
        [op],
        entryPoint
    ])
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
        publicClient
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
