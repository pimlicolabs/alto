import {
    getAbiItem,
    type Transaction,
    TransactionNotFoundError,
    decodeFunctionData,
    toFunctionSelector,
    slice,
    getAddress
} from "viem"
import { toUnpackedUserOperation } from "../../utils/userop"
import { createMethodHandler } from "../createMethodHandler"
import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    type HexData32,
    type PackedUserOperation,
    type UserOperation,
    type UserOperationV06,
    type UserOperationV07,
    getUserOperationByHashSchema
} from "@alto/types"

const userOperationEventAbiItem = getAbiItem({
    abi: EntryPointV06Abi,
    name: "UserOperationEvent"
})

export const ethGetUserOperationByHashHandler = createMethodHandler({
    method: "eth_getUserOperationByHash",
    schema: getUserOperationByHashSchema,
    handler: async ({ rpcHandler, params }) => {
        const [userOperationHash] = params

        let fromBlock: bigint | undefined
        let toBlock: "latest" | undefined
        if (rpcHandler.config.maxBlockRange !== undefined) {
            const latestBlock =
                await rpcHandler.config.publicClient.getBlockNumber()
            fromBlock = latestBlock - BigInt(rpcHandler.config.maxBlockRange)
            if (fromBlock < 0n) {
                fromBlock = 0n
            }
            toBlock = "latest"
        }

        const filterResult = await rpcHandler.config.publicClient.getLogs({
            address: rpcHandler.config.entrypoints,
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
                return await rpcHandler.config.publicClient.getTransaction({
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
