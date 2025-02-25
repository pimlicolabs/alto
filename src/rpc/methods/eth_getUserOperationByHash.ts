import {
    decodeFunctionData,
    getAbiItem,
    getAddress,
    slice,
    toFunctionSelector
} from "viem/utils"
import { createMethodHandler } from "../types"
import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    HexData32,
    PackedUserOperation,
    UserOperation,
    UserOperationV06,
    UserOperationV07,
    getUserOperationByHashSchema
} from "@alto/types"
import { Transaction, TransactionNotFoundError } from "viem"
import { toUnpackedUserOperation } from "../../utils/userop"

export const getUserOperationByHashHandler = createMethodHandler({
    schema: getUserOperationByHashSchema,
    handler: async ({ relay, params }) => {
        const userOperationEventAbiItem = getAbiItem({
            abi: EntryPointV06Abi,
            name: "UserOperationEvent"
        })

        const [userOperationHash] = params

        let fromBlock: bigint | undefined
        let toBlock: "latest" | undefined
        if (relay.config.maxBlockRange !== undefined) {
            const latestBlock = await relay.config.publicClient.getBlockNumber()
            fromBlock = latestBlock - BigInt(relay.config.maxBlockRange)
            if (fromBlock < 0n) {
                fromBlock = 0n
            }
            toBlock = "latest"
        }

        const filterResult = await relay.config.publicClient.getLogs({
            address: relay.config.entrypoints,
            event: userOperationEventAbiItem,
            fromBlock,
            toBlock,
            args: {
                userOpHash: userOperationHash
            }
        })

        if (filterResult.length === 0) {
            return null
        }

        const userOperationEvent = filterResult[0]
        const txHash = userOperationEvent.transactionHash
        if (txHash === null) {
            // transaction pending
            return null
        }

        const getTransaction = async (
            txHash: HexData32
        ): Promise<Transaction> => {
            try {
                return await relay.config.publicClient.getTransaction({
                    hash: txHash
                })
            } catch (e) {
                if (e instanceof TransactionNotFoundError) {
                    return getTransaction(txHash)
                }

                throw e
            }
        }

        const tx = await getTransaction(txHash)

        if (!tx.to) {
            return null
        }

        let op: UserOperationV06 | UserOperationV07
        try {
            const decoded = decodeFunctionData({
                abi: [...EntryPointV06Abi, ...EntryPointV07Abi],
                data: tx.input
            })

            if (decoded.functionName !== "handleOps") {
                return null
            }

            const ops = decoded.args[0]
            const foundOp = ops.find(
                (op: UserOperationV06 | PackedUserOperation) =>
                    op.sender === userOperationEvent.args.sender &&
                    op.nonce === userOperationEvent.args.nonce
            )

            if (foundOp === undefined) {
                return null
            }

            const handleOpsV07AbiItem = getAbiItem({
                abi: EntryPointV07Abi,
                name: "handleOps"
            })
            const handleOpsV07Selector = toFunctionSelector(handleOpsV07AbiItem)

            if (slice(tx.input, 0, 4) === handleOpsV07Selector) {
                op = toUnpackedUserOperation(foundOp as PackedUserOperation)
            } else {
                op = foundOp as UserOperationV06
            }
        } catch {
            return null
        }

        return {
            userOperation: Object.fromEntries(
                Object.entries(op).filter(([_, v]) => v !== null)
            ) as UserOperation,
            entryPoint: getAddress(tx.to),
            transactionHash: txHash,
            blockHash: tx.blockHash ?? "0x",
            blockNumber: BigInt(tx.blockNumber ?? 0n)
        }
    }
})
