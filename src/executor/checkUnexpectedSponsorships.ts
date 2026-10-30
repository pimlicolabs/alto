import type { UserOpInfo } from "@alto/types"
import type { Logger } from "@alto/utils"
import {
    type Hex,
    type TransactionReceipt,
    getAddress,
    parseAbiItem,
    slice,
    toEventSelector
} from "viem"
import { getUserOpHashes } from "./utils"

// Emitted by Pimlico's paymasters for every userOperation they pay for.
const USER_OPERATION_SPONSORED_TOPIC = toEventSelector(
    parseAbiItem(
        "event UserOperationSponsored(bytes32 indexed userOpHash, address indexed user, uint8 paymasterMode, address token, uint256 tokenAmountPaid, uint256 exchangeRate)"
    )
)

// Every UserOperationSponsored event in a bundle should be for one of the
// bundle's userOps. Any other means a userOp in the bundle called an
// EntryPoint itself (e.g. handleOps on another EntryPoint version) and got a
// paymaster to pay for userOps the bundler never validated.
export const checkUnexpectedSponsorships = ({
    receipt,
    userOps,
    logger
}: {
    receipt: TransactionReceipt
    userOps: UserOpInfo[]
    logger: Logger
}) => {
    const bundleUserOpHashes = getUserOpHashes(userOps)
    const expectedUserOpHashes = new Set(
        bundleUserOpHashes.map((userOpHash) => userOpHash.toLowerCase())
    )

    for (const log of receipt.logs) {
        const [topic, userOpHash, user] = log.topics as (Hex | undefined)[]
        if (topic !== USER_OPERATION_SPONSORED_TOPIC || !userOpHash) {
            continue
        }

        if (expectedUserOpHashes.has(userOpHash.toLowerCase())) {
            continue
        }

        logger.warn(
            {
                transactionHash: receipt.transactionHash,
                blockNumber: receipt.blockNumber.toString(),
                paymaster: getAddress(log.address),
                userOpHash,
                user: user ? getAddress(slice(user, 12)) : undefined,
                bundleUserOpHashes
            },
            "unexpected UserOperationSponsored event in included bundle"
        )
    }
}
