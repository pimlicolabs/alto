import {
    EntryPointAbi,
    type MempoolUserOperation,
    deriveUserOperation
} from "@alto/types"
import {
    type Logger,
    getNonceKeyAndValue,
    getUserOperationHash
} from "@alto/utils"
import {
    type Address,
    type Chain,
    type Hash,
    type MulticallReturnType,
    type PublicClient,
    type Transport,
    getContract
} from "viem"
import type { Mempool, Monitor } from "@alto/mempool"

type QueuedUserOperation = {
    userOperationHash: Hash
    mempoolUserOperation: MempoolUserOperation
    nonceKey: bigint
    nonceValue: bigint
    addedAt: number
}

export class NonceQueuer {
    queuedUserOperations: QueuedUserOperation[] = []

    mempool: Mempool
    publicClient: PublicClient<Transport, Chain>
    entryPoint: Address
    logger: Logger
    monitor: Monitor

    constructor(
        mempool: Mempool,
        publicClient: PublicClient<Transport, Chain>,
        entryPoint: Address,
        logger: Logger,
        monitor: Monitor
    ) {
        this.mempool = mempool
        this.publicClient = publicClient
        this.entryPoint = entryPoint
        this.logger = logger
        this.monitor = monitor;

        setInterval(() => {
            this.process()
        }, 2000)
    }

    async process() {
        // remove queued ops that have been in the queue for more than 15 minutes
        this.queuedUserOperations = this.queuedUserOperations.filter((qop) => {
            const isStale = qop.addedAt <= Date.now() - 1000 * 60 * 15;
            if (isStale) {
                this.monitor.setUserOperationStatus(qop.userOperationHash, { status: "not_found", transactionHash: null });
            }
            return !isStale;
        })

        if (this.queuedUserOperations.length === 0) {
            return
        }

        const availableOps = await this.getAvailableUserOperations(
            this.publicClient,
            this.entryPoint
        )

        if (availableOps.length === 0) {
            return
        }

        this.queuedUserOperations = this.queuedUserOperations.filter((qop) => {
            return !availableOps.some((op) => {
                return op.userOperationHash === qop.userOperationHash
            })
        })

        availableOps.map((op) => {
            this.resubmitUserOperation(op.mempoolUserOperation)
        })

        this.logger.info(
            { availableOps: availableOps.map((qop) => qop.userOperationHash) },
            "submitted user operations from nonce queue"
        )
    }

    add(mempoolUserOperation: MempoolUserOperation) {
        const op = deriveUserOperation(mempoolUserOperation)
        const [nonceKey, nonceValue] = getNonceKeyAndValue(op.nonce)
        const opHash = getUserOperationHash(
            deriveUserOperation(mempoolUserOperation),
            this.entryPoint,
            this.publicClient.chain.id
        )
        this.queuedUserOperations.push({
            userOperationHash: opHash,
            mempoolUserOperation: mempoolUserOperation,
            nonceKey: nonceKey,
            nonceValue: nonceValue,
            addedAt: Date.now()
        })
        this.monitor.setUserOperationStatus(opHash, {
            status: "queued",
            transactionHash: null
        })
    }

    resubmitUserOperation(mempoolUserOperation: MempoolUserOperation) {
        const userOperation = mempoolUserOperation
        this.logger.info(
            { userOperation: userOperation },
            "submitting user operation from nonce queue"
        )
        const result = this.mempool.add(mempoolUserOperation)
        if (result) {
            this.logger.info(
                { userOperation: userOperation, result: result },
                "added user operation"
            )
        } else {
            this.logger.error("error adding user operation")
        }
    }

    async getAvailableUserOperations(
        publicClient: PublicClient,
        entryPoint: Address
    ) {
        const queuedUserOperations = this.queuedUserOperations.slice()

        let results: MulticallReturnType

        try {
            results = await publicClient.multicall({
                contracts: queuedUserOperations.map((qop) => {
                    const userOp = deriveUserOperation(qop.mempoolUserOperation)
                    return {
                        address: entryPoint,
                        abi: EntryPointAbi,
                        functionName: "getNonce",
                        args: [userOp.sender, qop.nonceKey]
                    }
                }),
                blockTag: "latest"
            })
        } catch (error) {
            this.logger.error(
                { error: JSON.stringify(error) },
                "error fetching with multiCall"
            )

            const entryPointContract = getContract({
                abi: EntryPointAbi,
                address: entryPoint,
                publicClient: publicClient
            })

            results = await Promise.all(
                queuedUserOperations.map(async (qop) => {
                    const userOp = deriveUserOperation(qop.mempoolUserOperation)
                    try {
                        const nonce = await entryPointContract.read.getNonce(
                            [userOp.sender, qop.nonceKey],
                            { blockTag: "latest" }
                        )
                        return {
                            result: nonce,
                            status: "success"
                        }
                    } catch (e) {
                        return {
                            error: e as Error,
                            status: "failure"
                        }
                    }
                })
            )
        }

        if (results.length !== queuedUserOperations.length) {
            this.logger.error("error fetching nonces")
            return []
        }

        const currentOutstandingOps: QueuedUserOperation[] = []

        for (let i = 0; i < queuedUserOperations.length; i++) {
            const qop = queuedUserOperations[i]
            const result = results[i]

            if (result.status !== "success") {
                this.logger.error(
                    { error: result.error },
                    "error fetching nonce"
                )
                continue
            }

            const onchainNonceValue = result.result

            if (onchainNonceValue === qop.nonceValue) {
                currentOutstandingOps.push(qop)
            }
        }

        return currentOutstandingOps
    }
}
