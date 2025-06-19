import { Logger } from "pino"
import { Hex, PublicClient, decodeEventLog } from "viem"
import { EntryPointV06Abi, EntryPointV07Abi } from "../types/contracts"
import { SubmittedBundleInfo } from "../types/mempool"
import { areAddressesEqual } from "../utils/helpers"
import * as sentry from "@sentry/node"

type UserOperationDetailsType = {
    accountDeployed: boolean
    status: "succesful" | "calldata_phase_reverted"
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

    const txHashesToCheck = [currentHash, ...previousHashes]

    const receipts = await Promise.all(
        txHashesToCheck.map((hash) =>
            publicClient.getTransactionReceipt({ hash }).catch(() => undefined)
        )
    )

    // Check if any of the receipts are included
    const includedReceipt = receipts.find(
        (receipt) => receipt?.status === "success"
    )

    if (includedReceipt) {
        const { logs, blockNumber } = includedReceipt
        const userOperationDetails = logs
            .filter((log) => areAddressesEqual(log.address, entryPoint))
            .reduce((result: Record<Hex, UserOperationDetailsType>, log) => {
                try {
                    const { data, topics } = log
                    const { eventName, args } = decodeEventLog({
                        abi: [...EntryPointV06Abi, ...EntryPointV07Abi],
                        data,
                        topics
                    })

                    if (
                        eventName === "AccountDeployed" ||
                        eventName === "UserOperationRevertReason" ||
                        eventName === "UserOperationEvent"
                    ) {
                        const opHash = args.userOpHash

                        // create result entry if doesn't exist
                        result[opHash] ??= {
                            accountDeployed: false,
                            status: "succesful"
                        }

                        switch (eventName) {
                            case "AccountDeployed": {
                                result[opHash].accountDeployed = true
                                break
                            }
                            case "UserOperationRevertReason": {
                                result[opHash].revertReason = args.revertReason
                                break
                            }
                            case "UserOperationEvent": {
                                const status = args.success
                                    ? "succesful"
                                    : "calldata_phase_reverted"
                                result[opHash].status = status
                                break
                            }
                        }
                    }
                } catch (e) {
                    sentry.captureException(e)
                }

                return result
            }, {})

        return {
            status: "included",
            userOperationDetails,
            blockNumber
        }
    }

    // Check if any of the receipts reverted
    const revertedReceipt = receipts.find(
        (receipt) => receipt?.status === "reverted"
    )

    if (revertedReceipt) {
        return {
            status: "reverted",
            blockNumber: revertedReceipt.blockNumber
        }
    }

    // If none of the receipts are included or reverted, return not_found
    return { status: "not_found" }
}
