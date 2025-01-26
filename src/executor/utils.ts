import { type UserOperation } from "@alto/types"
import type { Logger } from "@alto/utils"
// biome-ignore lint/style/noNamespaceImport: explicitly make it clear when sentry is used
import * as sentry from "@sentry/node"
import {
    type Account,
    type Chain,
    type PublicClient,
    type Transport,
    type WalletClient,
    BaseError
} from "viem"
import { SignedAuthorizationList } from "viem/experimental"

export const isTransactionUnderpricedError = (e: BaseError) => {
    return e?.details
        ?.toLowerCase()
        .includes("replacement transaction underpriced")
}

export const getAuthorizationList = (
    userOperations: UserOperation[]
): SignedAuthorizationList | undefined => {
    const authorizationList = userOperations
        .map((op) => {
            if (op.eip7702Auth) {
                return op.eip7702Auth
            }
            return undefined
        })
        .filter((auth) => auth !== undefined) as SignedAuthorizationList

    return authorizationList.length > 0 ? authorizationList : undefined
}

export async function flushStuckTransaction(
    publicClient: PublicClient,
    walletClient: WalletClient<Transport, Chain, Account | undefined>,
    wallet: Account,
    gasPrice: bigint,
    logger: Logger
) {
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
