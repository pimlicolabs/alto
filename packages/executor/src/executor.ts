import { EntryPointAbi } from "@alto/types"
import { Mempool, MempoolEntry, UserOpStatus } from "@alto/mempool"
import { Address, HexData32, UserOperation } from "@alto/types"
import { PublicClient, WalletClient, getContract, Account } from "viem"
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
    executeEOA : Account | Address

    constructor(
        mempool: Mempool,
        beneficiary: Address,
        publicClient: PublicClient,
        walletClient: WalletClient,
        executeEOA: Account | Address
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
    cronJob : CronJob
    constructor(
        mempool: Mempool,
        beneficiary: Address,
        publicClient: PublicClient,
        walletClient: WalletClient,
        executeEOA: Account | Address,
        cronSetting?: string
    ){
        super(mempool, beneficiary, publicClient, walletClient, executeEOA)
        this.cronJob = new CronJob(cronSetting? cronSetting : "*/5 * * * *", async () => {
            await this.processBundle()
        })
    }

    run() {
        this.cronJob.start()
    }

    kill() {
        this.cronJob.stop();
    }

    async processBundle() : Promise<void>{
        console.log("hmm")
        const ops = await this.mempool.find((entry) => entry.status === UserOpStatus.NotIncluded)
        console.log(ops)
        const groupedOps = this.groupOps(ops)
        console.log(groupedOps)
        for (const [entrypoint, ops] of groupedOps) {
            const tx = await this.bundle(entrypoint, ops.map((op) => op.userOp))
            console.log(`Bundle ${tx} sent`)
            await this.mempool.markProcessed(ops.map((op) => op.opHash), {
                status: UserOpStatus.Included,
                transactionHash: tx
            })
        }
    }

    groupOps(ops:Array<{ entry: MempoolEntry; opHash: HexData32 }>): Map<Address, Array<{ userOp: UserOperation; opHash: HexData32 }>> {
        const groupedOps = new Map<Address, Array<{ userOp: UserOperation; opHash: HexData32 }>>()
        for (const op of ops) {
            const entrypoint = op.entry.entrypointAddress
            const userOp = op.entry.userOperation
            if (groupedOps.has(entrypoint)) {
                groupedOps.get(entrypoint)?.push({
                    userOp,
                    opHash: op.opHash
                })
            } else {
                groupedOps.set(entrypoint, [{
                    userOp,
                    opHash: op.opHash
                }])
            }
        }
        return groupedOps
    }

    async bundle(entryPoint: Address, ops: UserOperation[]): Promise<HexData32> {
        console.log("Bundle", entryPoint, ops)
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
