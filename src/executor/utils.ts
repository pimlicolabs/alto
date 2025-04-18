import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    type PackedUserOperation,
    type UserOpInfo,
    type UserOperationV07,
    UserOperation
} from "@alto/types"
import {
    isVersion06,
    toPackedUserOperation,
    type Logger,
    isVersion07
} from "@alto/utils"
import * as sentry from "@sentry/node"
import {
    type Account,
    type BaseError,
    encodeFunctionData,
    type Address,
    type Hex,
    toBytes
} from "viem"
import type { AltoConfig } from "../createConfig"
import type { SignedAuthorizationList } from "viem"

export const isTransactionUnderpricedError = (e: BaseError) => {
    const transactionUnderPriceError = e.walk((e: any) =>
        e?.message
            ?.toLowerCase()
            .includes("replacement transaction underpriced")
    )
    return transactionUnderPriceError !== null
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
                10_000n

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
    const isV06 = isVersion06(userOps[0])
    const packedUserOps = isV06
        ? userOps
        : userOps.map((op) => toPackedUserOperation(op as UserOperationV07))
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

export const getAuthorizationList = (
    userOpInfos: UserOpInfo[]
): SignedAuthorizationList | undefined => {
    const authList = userOpInfos
        .map(({ userOp }) => userOp)
        .map(({ eip7702Auth }) =>
            eip7702Auth
                ? {
                      address:
                          "address" in eip7702Auth
                              ? eip7702Auth.address
                              : eip7702Auth.contractAddress,
                      chainId: eip7702Auth.chainId,
                      nonce: eip7702Auth.nonce,
                      r: eip7702Auth.r,
                      s: eip7702Auth.s,
                      v: eip7702Auth.v,
                      yParity: eip7702Auth.yParity
                  }
                : null
        )
        .filter(Boolean) as SignedAuthorizationList

    return authList.length ? authList : undefined
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
    const walletClient = config.walletClient

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
        } catch (e) {
            sentry.captureException(e)
            logger.warn({ error: e }, "error flushing stuck transaction")
        }
    }
}
