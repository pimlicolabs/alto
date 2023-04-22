import { EntryPointAbi } from "@alto/types"
import { Mempool, MempoolEntry, UserOpStatus } from "@alto/mempool"
import { Address, HexData32, UserOperation } from "@alto/types"
import { PublicClient, WalletClient, getContract } from "viem"
import { CronJob } from "cron"

export interface GasEstimateResult {
    preverificationGas: bigint
    verificationGasLimit: bigint
    callGasLimit: bigint
}

export abstract class Executor {
    mempool: Mempool
    beneficiary: Address
    publicClient: PublicClient
    walletClient: WalletClient
    executeEOA : Address

    constructor(
        mempool: Mempool,
        beneficiary: Address,
        publicClient: PublicClient,
        walletClient: WalletClient,
        executeEOA: Address
    ) {
        this.mempool = mempool
        this.beneficiary = beneficiary
        this.publicClient = publicClient
        this.walletClient = walletClient
        this.executeEOA = executeEOA
    }

    abstract bundle(_entryPoint: Address,_ops: UserOperation[]): Promise<HexData32>
}

export class BasicExecutor extends Executor {
    async run(): Promise<void> {
        console.log("Executor started")
        const job = new CronJob("*/5 * * * * *", async () => {
            const ops = await this.mempool.getAll()
            const groupedOps = this.groupOps(ops)
            for (const [entrypoint, ops] of groupedOps) {
                const tx = await this.bundle(entrypoint, ops)
                console.log(`Bundle ${tx} sent`)
            }
        })
        job.start()
    }

    groupOps(ops: MempoolEntry[]): Map<Address, UserOperation[]> {
        const groupedOps = new Map<Address, UserOperation[]>()
        for (const op of ops) {
            if (op.status === UserOpStatus.NotIncluded) {
                const entrypoint = op.entrypointAddress
                const userOp = op.userOperation
                if (groupedOps.has(entrypoint)) {
                    groupedOps.get(entrypoint)?.push(userOp)
                } else {
                    groupedOps.set(entrypoint, [userOp])
                }
            }
        }
        return groupedOps
    }
    async bundle(entryPoint: Address, ops: UserOperation[]): Promise<HexData32> {
        const ep = getContract({
            abi: EntryPointAbi,
            address: entryPoint,
            publicClient: this.publicClient,
            walletClient: this.walletClient
        })

        const gasLimit = await ep.estimateGas.handleOps([ops, this.beneficiary]).then((limit) => {
            return (limit * 12n) / 10n
        })

        const tx = await ep.write.handleOps([ops, this.beneficiary], {
            gas: gasLimit,
            account: this.executeEOA,
            chain: null
        })

        return tx
    }
}
