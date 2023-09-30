import { EntryPointAbi, UserOperation } from "@alto/types"
import { Logger, getNonceKeyAndValue, getUserOpHash } from "@alto/utils"
import { Address, Chain, PublicClient, Transport } from "viem"
import { Mempool } from "@alto/mempool"

export class NonceQueuer {
    queuedUserOperations: UserOperation[] = []

    mempool: Mempool
    publicClient: PublicClient<Transport, Chain>
    entryPoint: Address
    logger: Logger

    constructor(mempool: Mempool, publicClient: PublicClient<Transport, Chain>, entryPoint: Address, logger: Logger) {
        this.mempool = mempool
        this.publicClient = publicClient
        this.entryPoint = entryPoint
        this.logger = logger

        setInterval(() => {
            this.process()
        }, 1000)
    }

    async process() {
        if (this.queuedUserOperations.length === 0) {
            return
        }

        const availableOps = await this.getAvailableUserOperations(this.publicClient, this.entryPoint)

        if (availableOps.length === 0) {
            return
        }

        this.queuedUserOperations = this.queuedUserOperations.filter((op) => {
            return !availableOps.find(
                (availableOp) =>
                    getUserOpHash(availableOp, this.entryPoint, this.publicClient.chain.id) ===
                    getUserOpHash(op, this.entryPoint, this.publicClient.chain.id)
            )
        })

        availableOps.map((op) => {
            this.resubmitUserOperation(op)
        })
    }

    add(userOperation: UserOperation) {
        this.queuedUserOperations.push(userOperation)
    }

    private async resubmitUserOperation(userOperation: UserOperation) {
        this.logger.info({ userOperation: userOperation }, "submitting user operation from nonce queue")
        const result = this.mempool.add(userOperation)
        if (result) {
            this.logger.info({ userOperation: userOperation, result: result }, "added user operation")
        } else {
            this.logger.error("error adding user operation")
        }
    }

    async getAvailableUserOperations(publicClient: PublicClient, entryPoint: Address) {
        const outstandingOps = this.queuedUserOperations.slice()

        function getSenderNonceKeyPair(op: UserOperation) {
            const [nonceKey, _] = getNonceKeyAndValue(op)

            return `${op.sender}_${nonceKey}`
        }

        function parseSenderNonceKeyPair(senderNonceKeyPair: string) {
            const [rawSender, rawNonceKey] = senderNonceKeyPair.split("_")

            const sender = rawSender as Address
            const nonceKey = BigInt(rawNonceKey)

            return { sender, nonceKey }
        }

        // get all unique senders and nonceKey pairs from outstanding, processing and submitted ops
        const allSendersAndNonceKeysRaw = new Set([...outstandingOps.map((op) => getSenderNonceKeyPair(op))])

        const allSendersAndNonceKeys = [...allSendersAndNonceKeysRaw].map((senderNonceKeyPair) =>
            parseSenderNonceKeyPair(senderNonceKeyPair)
        )

        const results = await publicClient.multicall({
            contracts: allSendersAndNonceKeys.map((senderNonceKeyPair) => {
                return {
                    address: entryPoint,
                    abi: EntryPointAbi,
                    functionName: "getNonce",
                    args: [senderNonceKeyPair.sender, senderNonceKeyPair.nonceKey]
                }
            })
        })

        const availableOutstandingOps: UserOperation[] = []

        for (let i = 0; i < allSendersAndNonceKeys.length; i++) {
            const senderAndNonceKey = allSendersAndNonceKeys[i]
            const sender = senderAndNonceKey.sender
            const nonceKey = senderAndNonceKey.nonceKey
            const result = results[i]

            if (result.status === "success") {
                const nonceValue = result.result

                outstandingOps.map((op) => {
                    const [outstandingOpNonceKey, outstandingOpNonceValue] = getNonceKeyAndValue(op)

                    if (
                        op.sender === sender &&
                        outstandingOpNonceKey === nonceKey &&
                        outstandingOpNonceValue === nonceValue
                    ) {
                        availableOutstandingOps.push(op)
                    }
                })
            } else {
                this.logger.error({ error: result.error }, "error fetching nonce")
            }
        }

        return availableOutstandingOps
    }
}
