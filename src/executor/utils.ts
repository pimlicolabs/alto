import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    type PackedUserOperation,
    type UserOpInfo,
    type UserOperation,
    type UserOperation07
} from "@alto/types"
import {
    type Logger,
    isVersion06,
    isVersion07,
    maxBigInt,
    scaleBigIntByPercent,
    toPackedUserOp
} from "@alto/utils"
import * as sentry from "@sentry/node"
import {
    type Account,
    type Address,
    BaseError,
    FeeCapTooLowError,
    type Hex,
    RpcRequestError,
    type SignedAuthorizationList,
    encodeFunctionData,
    hexToNumber,
    isHex,
    toBytes
} from "viem"
import type { AltoConfig } from "../createConfig"
import { EIP2780_MAX_AUTH_GAS, getEip7702AuthAddress } from "../utils/eip7702"

// Thrown during a replacement when the executor nonce was consumed by another
// transaction. The caller resolves whether it was one of the bundle's own
// transactions (resending would revert with AA25) or an unknown transaction
// (the userOps can be resubmitted).
export class ReplacementNonceConflictError extends Error {
    constructor() {
        super("Replacement nonce consumed by another transaction")
        this.name = "ReplacementNonceConflictError"
    }
}

export const getBundleGasLimit = async ({
    config,
    userOps,
    entryPoint,
    executorAddress
}: {
    config: AltoConfig
    userOps: UserOperation[]
    entryPoint: Address
    executorAddress: Address
}): Promise<bigint> => {
    const { skipLocalGasCalculations, publicClient } = config

    let gasLimit: bigint

    // On some chains we can't rely on local calculations and have to estimate the gasLimit from RPC
    if (skipLocalGasCalculations) {
        const authorizationList = getAuthorizationListFromUserOps(userOps)

        gasLimit = await publicClient.estimateGas({
            to: entryPoint,
            account: executorAddress,
            data: encodeHandleOpsCalldata({
                userOps: userOps,
                beneficiary: executorAddress
            }),
            authorizationList
        })
    } else {
        const aa95GasFloor = calculateAA95GasFloor({
            userOps: userOps,
            beneficiary: executorAddress
        })

        const authCount = getAuthorizationListFromUserOps(userOps)?.length ?? 0
        // Under EIP-2780, state at inclusion time is unknown here, so assume
        // each authority is a new account without a delegation indicator
        const perAuthGas = config.supportsEip2780
            ? EIP2780_MAX_AUTH_GAS
            : 40_000n
        const eip7702Overhead = BigInt(authCount) * perAuthGas

        gasLimit = aa95GasFloor + eip7702Overhead

        // EIP-7623 / EIP-7976: a gasLimit below the calldata floor is invalid
        if (config.supportsEip7623 || config.supportsEip7976) {
            const calldata = toBytes(
                encodeHandleOpsCalldata({
                    userOps,
                    beneficiary: executorAddress
                })
            )

            let floorGas: bigint
            if (config.supportsEip7976) {
                floorGas =
                    BigInt(calldata.length) * config.eip7976FloorPerByteGas
            } else {
                const nonZeroBytes = BigInt(
                    calldata.filter((byte) => byte !== 0).length
                )
                const zeroBytes = BigInt(calldata.length) - nonZeroBytes
                const tokens =
                    zeroBytes +
                    nonZeroBytes * config.eip7623TokensPerNonzeroByte
                floorGas = tokens * config.eip7623FloorPerTokenGas
            }

            gasLimit = maxBigInt(
                gasLimit,
                config.transactionGasStipend + floorGas
            )
        }
    }

    return scaleBigIntByPercent(gasLimit, config.executorGasMultiplier)
}

export const isTransactionUnderpricedError = (e: BaseError) => {
    const transactionUnderPriceError = e.walk((e: any) => {
        const message = e?.message?.toLowerCase()
        return (
            message?.includes("replacement transaction underpriced") || // Geth error message
            message?.includes("could not replace existing tx") // Erigon error message
        )
    })
    return transactionUnderPriceError !== null
}

// Viem wraps node errors, so FeeCapTooLowError arrives nested in the
// cause chain rather than as the thrown value.
export const isFeeCapTooLowError = (e: BaseError) => {
    return e.walk((err) => err instanceof FeeCapTooLowError) !== null
}

// eth_sendRawTransactionSync error codes (EIP-7966).
const SYNC_SEND_TIMEOUT_CODE = 4
const SYNC_SEND_NOT_READY_CODE = 5
const SYNC_SEND_NONCE_GAP_CODE = 6

const findRpcRequestError = (
    e: BaseError,
    code: number
): RpcRequestError | undefined => {
    const rpcError = e.walk(
        (err) => err instanceof RpcRequestError && err.code === code
    )
    return rpcError instanceof RpcRequestError ? rpcError : undefined
}

// eth_sendRawTransactionSync errors that still mean the transaction is in the
// pool: the node timed out waiting for inclusion (EIP-7966 code 4), or it
// already has the same signed transaction.
export const isTransactionPendingError = (e: BaseError) => {
    const pendingError = e.walk((err) => {
        if (
            err instanceof RpcRequestError &&
            err.code === SYNC_SEND_TIMEOUT_CODE
        ) {
            return true
        }
        return (err as Error).message?.toLowerCase().includes("already known")
    })
    return pendingError !== null
}

// An eth_sendRawTransactionSync fan-out (see multiRpcTransport) that ended as
// soon as one endpoint answered that the transaction is pending (see
// isTransactionPendingError). The other endpoints may still respond with the
// receipt: receipt resolves to the first one's raw RPC receipt, or to
// undefined when none returns one, and never rejects.
export class SyncSendPendingError extends BaseError {
    readonly receipt: Promise<unknown>

    constructor({
        cause,
        receipt
    }: {
        cause: BaseError
        receipt: Promise<unknown>
    }) {
        super("transaction is pending, waiting for its receipt", {
            cause,
            name: "SyncSendPendingError"
        })
        this.receipt = receipt
    }
}

// eth_sendRawTransactionSync rejections that left the transaction out of the
// pool because it can't execute at its nonce (EIP-7966): code 5 when it isn't
// ready for execution, code 6 on a nonce gap, with the nonce the node expects
// as data. Undefined for any other error.
export const parseSyncSendNonceError = (
    e: BaseError
): { expectedNonce: number | undefined } | undefined => {
    const nonceGapError = findRpcRequestError(e, SYNC_SEND_NONCE_GAP_CODE)
    if (nonceGapError) {
        const { data } = nonceGapError
        const expectedNonce =
            typeof data === "string" && isHex(data)
                ? hexToNumber(data)
                : undefined
        return {
            expectedNonce: Number.isSafeInteger(expectedNonce)
                ? expectedNonce
                : undefined
        }
    }

    if (findRpcRequestError(e, SYNC_SEND_NOT_READY_CODE)) {
        return { expectedNonce: undefined }
    }

    return undefined
}

// Some nodes report the account's actual nonce in their "nonce too low" /
// "nonce too high" rejection. Viem keeps the raw node message in `details`.
//   nitro:        "nonce too low: address 0x.., tx: 389 state: 392"
//   geth/op-geth: "nonce too low: next nonce 392, tx nonce 389"
// Returns undefined when the message carries no nonce so callers can fall
// back to a blind +1 / -1 adjustment.
const NODE_NONCE_PATTERNS = [/\bstate:\s*(\d+)/i, /\bnext nonce\s*(\d+)/i]

export const parseNonceFromError = (e: BaseError): number | undefined => {
    const details = e.details
    if (!details) {
        return undefined
    }

    for (const pattern of NODE_NONCE_PATTERNS) {
        const match = details.match(pattern)
        if (match) {
            const nonce = Number(match[1])
            if (Number.isSafeInteger(nonce)) {
                return nonce
            }
        }
    }

    return undefined
}

// V7 source: https://github.com/eth-infinitism/account-abstraction/blob/releases/v0.7/contracts/core/EntryPoint.sol
// V6 source: https://github.com/eth-infinitism/account-abstraction/blob/fa61290d37d079e928d92d53a122efcc63822214/contracts/core/EntryPoint.sol#L236
export function calculateAA95GasFloor({
    userOps,
    beneficiary
}: { userOps: UserOperation[]; beneficiary: Address }): bigint {
    let gasFloor = 0n

    for (const userOp of userOps) {
        if (isVersion07(userOp)) {
            const totalGas =
                userOp.callGasLimit +
                (userOp.paymasterPostOpGasLimit || 0n) +
                10_000n // INNER_GAS_OVERHEAD

            gasFloor += (totalGas * 64n) / 63n

            // AA95 check happens after verification + paymaster verification
            gasFloor +=
                userOp.verificationGasLimit +
                (userOp.paymasterVerificationGasLimit || 0n)

            // There is a ~27,170 gas overhead for EntryPoint's re-entrency check
            gasFloor += 30_000n

            // There is a variable gas overhead for calldata gas when calling handleOps
            const calldata = encodeHandleOpsCalldata({
                userOps: [userOp],
                beneficiary
            })
            const handleOpsCalldataCost = toBytes(calldata)
                .map((x) => (x === 0 ? 4 : 16))
                .reduce((sum, x) => sum + x)

            gasFloor += BigInt(handleOpsCalldataCost)
        } else {
            gasFloor +=
                userOp.callGasLimit + userOp.verificationGasLimit + 5000n

            // AA95 check happens after verification + paymaster verification
            gasFloor += userOp.verificationGasLimit

            // There is a ~27,179 gas overhead for EntryPoint's re-entrency check
            gasFloor += 30_000n

            // There is a variable gas overhead for calldata gas when calling handleOps
            const calldata = encodeHandleOpsCalldata({
                userOps: [userOp],
                beneficiary
            })
            const handleOpsCalldataCost = toBytes(calldata)
                .map((x) => (x === 0 ? 4 : 16))
                .reduce((sum, x) => sum + x)

            gasFloor += BigInt(handleOpsCalldataCost)
        }
    }

    return gasFloor
}

export const getUserOpHashes = (userOpInfos: UserOpInfo[]) => {
    return userOpInfos.map(({ userOpHash }) => userOpHash)
}

export const packUserOps = (userOps: UserOperation[]) => {
    if (userOps.length === 0) {
        return []
    }

    const is06 = isVersion06(userOps[0])

    const packedUserOps = is06
        ? userOps
        : userOps.map((userOp) => toPackedUserOp(userOp as UserOperation07))

    return packedUserOps as PackedUserOperation[]
}

export const encodeHandleOpsCalldata = ({
    userOps,
    beneficiary
}: {
    userOps: UserOperation[]
    beneficiary: Address
}): Hex => {
    const isV06 = isVersion06(userOps[0])
    const packedUserOps = packUserOps(userOps)

    return encodeFunctionData({
        abi: isV06 ? EntryPointV06Abi : EntryPointV07Abi,
        functionName: "handleOps",
        args: [packedUserOps, beneficiary]
    })
}

export const getAuthorizationListFromUserOps = (
    userOps: UserOperation[]
): SignedAuthorizationList | undefined => {
    const authMap = new Map<Address, SignedAuthorizationList[number]>()

    // Deduplicate EIP-7702 auths if userOp.sender has multiple same eip7702Auth fields.
    for (const userOp of userOps) {
        const { eip7702Auth, sender } = userOp
        if (eip7702Auth && !authMap.has(sender)) {
            authMap.set(sender, {
                address: getEip7702AuthAddress(eip7702Auth),
                chainId: eip7702Auth.chainId,
                nonce: eip7702Auth.nonce,
                r: eip7702Auth.r,
                s: eip7702Auth.s,
                v: eip7702Auth.v,
                yParity: eip7702Auth.yParity
            })
        }
    }

    const authList = Array.from(authMap.values()) as SignedAuthorizationList
    return authList.length > 0 ? authList : undefined
}

// The nonce for an executor's next bundle. Under flashblocks an executor is
// freed once its transaction is preconfirmed, before the block including it
// is sealed, so "latest" can still return the nonce that transaction used.
// On a flashblocks node "pending" is the sealed nonce plus the sender's
// preconfirmed transactions and leaves out the mempool, so a transaction
// that isn't preconfirmed is never counted.
//
// ref
// - https://github.com/base/base/blob/bcd96e/crates/execution/flashblocks/src/rpc/eth.rs#L316-L331
// - https://github.com/base/base/blob/bcd96e/crates/execution/flashblocks/src/processor.rs#L664-L669
export function getExecutorNonce({
    config,
    address
}: {
    config: AltoConfig
    address: Address
}): Promise<number> {
    return config.publicClient.getTransactionCount({
        address,
        blockTag: config.flashblocksPreconfirmationTime ? "pending" : "latest"
    })
}

export async function flushStuckTransaction({
    config,
    wallet,
    gasPrice,
    logger
}: {
    config: AltoConfig
    wallet: Account
    gasPrice: bigint
    logger: Logger
}) {
    const publicClient = config.publicClient
    const walletClient = config.walletClients.public

    const latestNonce = await publicClient.getTransactionCount({
        address: wallet.address,
        blockTag: "latest"
    })
    const pendingNonce = await publicClient.getTransactionCount({
        address: wallet.address,
        blockTag: "pending"
    })

    logger.debug(
        { latestNonce, pendingNonce, wallet: wallet.address },
        "checking for stuck transactions"
    )

    // same nonce is okay
    if (latestNonce === pendingNonce) {
        return
    }

    // one nonce ahead is also okay
    if (latestNonce + 1 === pendingNonce) {
        return
    }

    logger.info(
        { latestNonce, pendingNonce, wallet: wallet.address },
        "found stuck transaction, flushing"
    )

    for (
        let nonceToFlush = latestNonce;
        nonceToFlush < pendingNonce;
        nonceToFlush++
    ) {
        try {
            const txHash = await walletClient.sendTransaction({
                account: wallet,
                to: wallet.address,
                value: 0n,
                nonce: nonceToFlush,
                maxFeePerGas: gasPrice,
                maxPriorityFeePerGas: gasPrice
            })

            logger.debug(
                { txHash, nonce: nonceToFlush, wallet: wallet.address },
                "flushed stuck transaction"
            )
        } catch (err) {
            sentry.captureException(err)
            logger.warn({ err }, "error flushing stuck transaction")
        }
    }
}
