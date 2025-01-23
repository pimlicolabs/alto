import type { EventManager } from "@alto/handlers"
import type { MemoryMempool } from "@alto/mempool"
import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    type MempoolUserOperation,
    deriveUserOperation
} from "@alto/types"
import type { Logger } from "@alto/utils"
import {
    encodeNonce,
    getNonceKeyAndValue,
    getUserOperationHash,
    isVersion06
} from "@alto/utils"
import {
    type Address,
    type Hash,
    type MulticallReturnType,
    type PublicClient,
    getContract
} from "viem"
import type { AltoConfig } from "../createConfig"

type QueuedUserOperation = {
    entryPoint: Address
    userOperationHash: Hash
    mempoolUserOperation: MempoolUserOperation
    nonceKey: bigint
    nonceSequence: bigint
    addedAt: number
}

export class NonceQueuer {
    queuedUserOperations: QueuedUserOperation[] = []

    config: AltoConfig
    mempool: MemoryMempool
    logger: Logger
    eventManager: EventManager

    constructor({
        config,
        mempool,
        eventManager
    }: {
        config: AltoConfig
        mempool: MemoryMempool
        eventManager: EventManager
    }) {
        this.config = config
        this.mempool = mempool
        this.logger = config.getLogger(
            { module: "nonce_queuer" },
            {
                level: config.nonceQueuerLogLevel || config.logLevel
            }
        )
        this.eventManager = eventManager

        setInterval(() => {
            this.process()
        }, 2000)
    }

    async process() {
        // remove queued ops that have been in the queue for more than 15 minutes
        this.queuedUserOperations = this.queuedUserOperations.filter((qop) => {
            return qop.addedAt > Date.now() - 1000 * 60 * 15
        })

        if (this.queuedUserOperations.length === 0) {
            return
        }

        const availableOps = await this.getAvailableUserOperations(
            this.config.publicClient
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
            this.resubmitUserOperation(op.mempoolUserOperation, op.entryPoint)
        })

        this.logger.info(
            { availableOps: availableOps.map((qop) => qop.userOperationHash) },
            "submitted user operations from nonce queue"
        )
    }

    add(mempoolUserOperation: MempoolUserOperation, entryPoint: Address) {
        const userOperation = deriveUserOperation(mempoolUserOperation)
        const [nonceKey, nonceSequence] = getNonceKeyAndValue(
            userOperation.nonce
        )

        const userOperationHash = getUserOperationHash(
            deriveUserOperation(mempoolUserOperation),
            entryPoint,
            this.config.publicClient.chain.id
        )
        this.queuedUserOperations.push({
            entryPoint,
            userOperationHash,
            mempoolUserOperation,
            nonceKey,
            nonceSequence,
            addedAt: Date.now()
        })

        this.eventManager.emitQueued(userOperationHash)
    }

    resubmitUserOperation(
        mempoolUserOperation: MempoolUserOperation,
        entryPoint: Address
    ) {
        const userOperation = mempoolUserOperation
        this.logger.info(
            { userOperation: userOperation },
            "submitting user operation from nonce queue"
        )
        const result = this.mempool.add(mempoolUserOperation, entryPoint)
        if (result) {
            this.logger.info(
                { userOperation: userOperation, result: result },
                "added user operation"
            )
        } else {
            this.logger.error("error adding user operation")
        }
    }

    async getAvailableUserOperations(publicClient: PublicClient) {
        const queuedUserOperations = this.queuedUserOperations.slice()

        let results: MulticallReturnType

        try {
            results = await publicClient.multicall({
                contracts: queuedUserOperations.map((qop) => {
                    const userOperation = deriveUserOperation(
                        qop.mempoolUserOperation
                    )

                    const isUserOpV06 = isVersion06(userOperation)

                    return {
                        address: qop.entryPoint,
                        abi: isUserOpV06 ? EntryPointV06Abi : EntryPointV07Abi,
                        functionName: "getNonce",
                        args: [userOperation.sender, qop.nonceKey]
                    }
                }),
                blockTag: this.config.blockTagSupport ? "latest" : undefined
            })
        } catch (error) {
            this.logger.error(
                { error: JSON.stringify(error) },
                "error fetching with multiCall"
            )

            results = await Promise.all(
                queuedUserOperations.map(async (qop) => {
                    const userOperation = deriveUserOperation(
                        qop.mempoolUserOperation
                    )
                    try {
                        const isUserOpV06 = isVersion06(userOperation)

                        const entryPointContract = isUserOpV06
                            ? getContract({
                                  abi: EntryPointV06Abi,
                                  address: qop.entryPoint,
                                  client: {
                                      public: publicClient
                                  }
                              })
                            : getContract({
                                  abi: EntryPointV07Abi,
                                  address: qop.entryPoint,
                                  client: {
                                      public: publicClient
                                  }
                              })

                        const nonce = await entryPointContract.read.getNonce(
                            [userOperation.sender, qop.nonceKey],
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

            const onchainNonce = result.result
            const qopNonce = encodeNonce({
                nonceSequence: qop.nonceSequence,
                nonceKey: qop.nonceKey
            })

            if (onchainNonce === qopNonce) {
                currentOutstandingOps.push(qop)
            }
        }

        return currentOutstandingOps
    }
}
