// import { MongoClient, Collection, Filter } from "mongodb"
// import { PublicClient, getContract } from "viem"
// import { EntryPointAbi } from "../types/EntryPoint"
import { TransactionInfo, UserOperation, UserOperationMempoolEntry, SubmissionStatus } from "@alto/types"
import { HexData32 } from "@alto/types"
import { IExecutor, getGasPrice } from "@alto/executor"
import { Monitor } from "./monitoring"
import { Address, Block, Chain, PublicClient, Transport, WatchBlocksReturnType } from "viem"
import { Logger } from "@alto/utils"
import { transactionIncluded } from "@alto/utils"

function getTransactionsFromUserOperationEntries(entries: UserOperationMempoolEntry[]): TransactionInfo[] {
    return Array.from(
        new Set(
            entries
                .filter(
                    (entry) => entry.status === SubmissionStatus.Submitted || entry.status === SubmissionStatus.Included
                )
                .map((entry) => {
                    if (entry.status === SubmissionStatus.Submitted || entry.status === SubmissionStatus.Included) {
                        return entry.transactionInfo
                    } else {
                        throw new Error("unreachable")
                    }
                })
        )
    )
}

export interface Mempool {
    add(op: UserOperation, userOpHash: HexData32): boolean
    take(gasLimit?: bigint): UserOperation[] | null
}

export class MemoryMempool implements Mempool {
    private unWatch: WatchBlocksReturnType | undefined

    private executor: IExecutor
    private monitor: Monitor
    private publicClient: PublicClient<Transport, Chain>
    private entryPointAddress: Address
    private pollingInterval: number
    private logger: Logger

    private monitoredTransactions: Map<HexData32, TransactionInfo> = new Map() // tx hash to info
    private monitoredUserOperations: Map<HexData32, UserOperationMempoolEntry> = new Map() // user op hash to info

    constructor(
        executor: IExecutor,
        monitor: Monitor,
        publicClient: PublicClient<Transport, Chain>,
        entryPointAddress: Address,
        pollingInterval: number,
        logger: Logger
    ) {
        this.executor = executor
        this.monitor = monitor
        this.publicClient = publicClient
        this.entryPointAddress = entryPointAddress
        this.pollingInterval = pollingInterval
        this.logger = logger

        setInterval(async () => {
            await this.bundle()
        }, 1000)
    }

    add(op: UserOperation, userOpHash: HexData32): boolean {
        this.monitoredUserOperations.set(userOpHash, {
            userOperationInfo: {
                userOperation: op,
                userOperationHash: userOpHash,
                firstSubmitted: Date.now(),
                lastReplaced: Date.now()
            },
            status: SubmissionStatus.NotSubmitted
        })
        this.monitor.setUserOperationStatus(userOpHash, { status: "not_submitted", transactionHash: null })
        return true
    }

    async refreshUserOperationStatus(userOpHash: HexData32): Promise<void> {
        const entry = this.monitoredUserOperations.get(userOpHash)
        if (entry?.status === SubmissionStatus.Submitted) {
            const included = await transactionIncluded(entry.transactionInfo.transactionHash, this.publicClient)
            if (included) {
                this.monitoredUserOperations.set(userOpHash, { ...entry, status: SubmissionStatus.Included })
            }
        }
    }

    async handleBlock(block: Block) {
        // refresh op statuses
        const userOpHashes = Array.from(this.monitoredUserOperations.keys())
        await Promise.all(userOpHashes.map((userOpHash) => this.refreshUserOperationStatus(userOpHash)))

        // for all still not included check if needs to be replaced (based on gas price)
        const gasPriceParameters = await getGasPrice(this.publicClient.chain.id, this.publicClient, this.logger)
        getTransactionsFromUserOperationEntries(
            Array.from(this.monitoredUserOperations.values()).filter(
                (entry) => entry.status === SubmissionStatus.Submitted
            )
        ).forEach((txInfo) => {})

        // for any left check if enough time has passed, if so replace

        this.executor
    }

    async replaceTransactions(): Promise<void> {}

    async bundle() {
        const ops = this.take()

        if (ops.length === 0) {
            return
        }

        const userOperationResults = await this.executor.bundle(this.entryPointAddress, ops)
        console.log(userOperationResults)
        userOperationResults.map((result) => {
            this.monitoredUserOperations.set(result.userOperationInfo.userOperationHash, result)
            if (result.status === SubmissionStatus.Submitted) {
                this.monitoredTransactions.set(result.transactionInfo.transactionHash, result.transactionInfo)
                this.monitor.setUserOperationStatus(result.userOperationInfo.userOperationHash, {
                    status: "submitted",
                    transactionHash: result.transactionInfo.transactionHash
                })
            } else if (result.status === SubmissionStatus.Rejected) {
                this.monitor.setUserOperationStatus(result.userOperationInfo.userOperationHash, {
                    status: "rejected",
                    transactionHash: null
                })
            }
        })
    }

    take(gasLimit?: bigint): UserOperation[] {
        const mempoolEntries = Array.from(this.monitoredUserOperations.values())
        const opInfos = mempoolEntries
            .filter((entry) => entry.status === SubmissionStatus.NotSubmitted)
            .map((entry) => entry.userOperationInfo)
        if (gasLimit) {
            let gasUsed = 0n
            const result: UserOperation[] = []
            for (const opInfo of opInfos) {
                gasUsed +=
                    opInfo.userOperation.callGasLimit +
                    opInfo.userOperation.verificationGasLimit * 3n +
                    opInfo.userOperation.preVerificationGas
                if (gasUsed > gasLimit) {
                    break
                }
                this.monitoredUserOperations.delete(opInfo.userOperationHash)
                result.push(opInfo.userOperation)
            }
            return result
        }

        return opInfos.map((opInfo) => {
            this.monitoredUserOperations.delete(opInfo.userOperationHash)
            return opInfo.userOperation
        })
    }

    get(opHash: HexData32): UserOperationMempoolEntry | null {
        return this.monitoredUserOperations.get(opHash) || null
    }

    startWatchingBlocks(handleBlock: (block: Block) => void): void {
        if (this.unWatch) {
            return
        }
        this.unWatch = this.publicClient.watchBlocks({
            onBlock: handleBlock,
            // onBlock: async (block) => {
            //     // Use an arrow function to ensure correct binding of `this`
            //     this.checkAndReplaceTransactions(block)
            //         .then(() => {
            //             this.logger.trace("block handled")
            //             // Handle the resolution of the promise here, if needed
            //         })
            //         .catch((error) => {
            //             // Handle any errors that occur during the execution of the promise
            //             this.logger.error({ error }, "error while handling block")
            //         })
            // },
            onError: (error) => {
                this.logger.error({ error }, "error while watching blocks")
            },
            emitMissed: false,
            includeTransactions: false,
            pollingInterval: this.pollingInterval
        })

        this.logger.debug("started watching blocks")
    }

    stopWatchingBlocks(): void {
        if (this.unWatch) {
            this.logger.debug("stopped watching blocks")
            this.unWatch()
            this.unWatch = undefined
        }
    }
}
