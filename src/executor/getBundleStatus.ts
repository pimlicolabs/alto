import { Logger } from "pino"
import { Hex, PublicClient, decodeEventLog, Log, Address } from "viem"
import { EntryPointV07Abi } from "../types/contracts"
import { SubmittedBundleInfo } from "../types/mempool"
import { areAddressesEqual } from "../utils/helpers"
import * as sentry from "@sentry/node"

type UserOperationDetailsType = {
    accountDeployed: boolean
    success: boolean
    revertReason?: Hex
}

export type BundleStatus =
    | {
          // The tx was successfully mined
          // The status of each userOperation is recorded in userOperaitonDetails
          status: "included"
          userOperationDetails: Record<Hex, UserOperationDetailsType>
          blockNumber: bigint
      }
    | {
          // The tx reverted due to a userOp in the bundle failing EntryPoint validation
          status: "reverted"
          blockNumber: bigint
      }
    | {
          // The tx could not be found (pending or invalid hash)
          status: "not_found"
      }

const parseUserOperationLogs = (
    logs: Log[],
    entryPoint: Address
): Record<Hex, UserOperationDetailsType> => {
    return logs
        .filter((log) => areAddressesEqual(log.address, entryPoint))
        .reduce((result: Record<Hex, UserOperationDetailsType>, log) => {
            try {
                const { eventName, args } = decodeEventLog({
                    // All EntryPoint versions have the same event interface
                    abi: EntryPointV07Abi,
                    data: log.data,
                    topics: log.topics
                })

                if (eventName === "AccountDeployed") {
                    const { userOpHash } = args

                    result[userOpHash] ??= {
                        accountDeployed: false,
                        success: true
                    }

                    result[userOpHash].accountDeployed = true
                }

                if (eventName === "UserOperationEvent") {
                    const { userOpHash, success } = args

                    result[userOpHash] ??= {
                        accountDeployed: false,
                        success: true
                    }

                    result[userOpHash].success = success
                }

                if (eventName === "UserOperationRevertReason") {
                    const { userOpHash, revertReason } = args

                    result[userOpHash] ??= {
                        accountDeployed: false,
                        success: false
                    }

                    result[userOpHash].revertReason = revertReason
                }
            } catch (e) {
                sentry.captureException(e)
            }

            return result
        }, {})
}

// Return the status of the bundling transaction.
export const getBundleStatus = async ({
    publicClient,
    submittedBundle,
    logger
}: {
    submittedBundle: SubmittedBundleInfo
    publicClient: PublicClient
    logger: Logger
}): Promise<BundleStatus> => {
    const {
        bundle,
        transactionHash: currentHash,
        previousTransactionHashes: previousHashes
    } = submittedBundle
    const { entryPoint } = bundle

    const receipts = await Promise.all(
        [currentHash, ...previousHashes].map((hash) =>
            publicClient.getTransactionReceipt({ hash }).catch(() => undefined)
        )
    )

    const includedReceipt = receipts.find(
        (receipt) => receipt?.status === "success"
    )

    // If any of the receipts are included.
    if (includedReceipt) {
        const { logs, blockNumber } = includedReceipt
        const userOperationDetails = parseUserOperationLogs(logs, entryPoint)

        return {
            status: "included",
            userOperationDetails,
            blockNumber
        }
    }

    const revertedReceipt = receipts.find(
        (receipt) => receipt?.status === "reverted"
    )

    // If any of the receipts reverted.
    if (revertedReceipt) {
        return {
            status: "reverted",
            blockNumber: revertedReceipt.blockNumber
        }
    }

    // If none of the receipts are included or reverted, return not_found.
    return { status: "not_found" }
}
