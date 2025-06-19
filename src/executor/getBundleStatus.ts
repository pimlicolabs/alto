import { Logger } from "pino"
import {
    Hex,
    PublicClient,
    decodeEventLog,
    Log,
    Address,
    getAbiItem
} from "viem"
import { EntryPointV07Abi } from "../types/contracts"
import { SubmittedBundleInfo } from "../types/mempool"
import { areAddressesEqual } from "../utils/helpers"
import * as sentry from "@sentry/node"

type UserOpDetailsType = {
    accountDeployed: boolean
    success: boolean
    revertReason?: Hex
}

export type BundleStatus =
    | {
          // The tx was successfully mined
          // The status of each userOperation is recorded in userOpDetails
          status: "included"
          userOpDetails: Record<Hex, UserOpDetailsType>
          transactionHash: Hex
          blockNumber: bigint
      }
    | {
          // The tx reverted due to a userOp in the bundle failing EntryPoint validation
          status: "reverted"
          transactionHash: Hex
          blockNumber: bigint
      }
    | {
          // The tx could not be found (pending or invalid hash)
          status: "not_found"
      }

const parseEntryPointLogs = (
    logs: Log[],
    entryPoint: Address
): Record<Hex, UserOpDetailsType> => {
    return logs
        .filter((log) => areAddressesEqual(log.address, entryPoint))
        .reduce((result: Record<Hex, UserOpDetailsType>, log) => {
            try {
                const { eventName, args } = decodeEventLog({
                    // All EntryPoint versions have the same event interface.
                    abi: [
                        getAbiItem({
                            abi: EntryPointV07Abi,
                            name: "UserOperationEvent"
                        }),
                        getAbiItem({
                            abi: EntryPointV07Abi,
                            name: "AccountDeployed"
                        }),
                        getAbiItem({
                            abi: EntryPointV07Abi,
                            name: "UserOperationRevertReason"
                        })
                    ],
                    data: log.data,
                    topics: log.topics
                })

                result[args.userOpHash] ??= {
                    accountDeployed: false,
                    success: true
                }

                if (eventName === "AccountDeployed") {
                    result[args.userOpHash].accountDeployed = true
                }

                if (eventName === "UserOperationEvent") {
                    result[args.userOpHash].success = args.success
                }

                if (eventName === "UserOperationRevertReason") {
                    result[args.userOpHash].revertReason = args.revertReason
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
        const { entryPoint } = bundle
        const { logs, blockNumber, transactionHash } = includedReceipt
        return {
            status: "included",
            userOpDetails: parseEntryPointLogs(logs, entryPoint),
            transactionHash,
            blockNumber
        }
    }

    const revertedReceipt = receipts.find(
        (receipt) => receipt?.status === "reverted"
    )

    // If any of the receipts reverted.
    if (revertedReceipt) {
        const { blockNumber, transactionHash } = revertedReceipt
        return {
            status: "reverted",
            blockNumber,
            transactionHash
        }
    }

    // If none of the receipts are included or reverted, return not_found.
    return { status: "not_found" }
}
