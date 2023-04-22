import { EntryPointAbi } from "@alto/types"
import { Mempool } from "@alto/mempool"
import { Address, HexData32, UserOperation } from "@alto/types"
import { PublicClient, WalletClient, getContract, Account } from "viem"

export interface GasEstimateResult {
    preverificationGas: bigint
    verificationGasLimit: bigint
    callGasLimit: bigint
}

export interface IExecutor {
    bundle(_entryPoint: Address, _ops: UserOperation[]): Promise<HexData32>
}

export class NullExecutor implements IExecutor {
    async bundle(_entryPoint: Address, _ops: UserOperation[]): Promise<HexData32> {
        // return 32 byte long hex string
        return "0x0000000000000000000000000000000000000000000000000000000000000000"
    }
}

export class BasicExecutor implements IExecutor {
    constructor(
        readonly mempool: Mempool,
        readonly beneficiary: Address,
        readonly publicClient: PublicClient,
        readonly walletClient: WalletClient,
        readonly executeEOA: Account
    ) {}

    /*
    async processBundle(): Promise<void> {
        const ops = await this.mempool.find((entry) => entry.status === UserOpStatus.NotIncluded)
        const groupedOps = this.groupOps(ops)
        for (const [entrypoint, ops] of groupedOps) {
            const tx = await this.bundle(
                entrypoint,
                ops.map((op) => op.userOp)
            )
            console.log(`Bundle ${tx} sent`)
            await this.mempool.markProcessed(
                ops.map((op) => op.opHash),
                {
                    status: UserOpStatus.Included,
                    transactionHash: tx
                }
            )
        }
    }
    */

    /*
    groupOps(
        ops: Array<{ entry: MempoolEntry; opHash: HexData32 }>
    ): Map<Address, Array<{ userOp: UserOperation; opHash: HexData32 }>> {
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
                groupedOps.set(entrypoint, [
                    {
                        userOp,
                        opHash: op.opHash
                    }
                ])
            }
        }
        return groupedOps
    }
    */

    async bundle(entryPoint: Address, ops: UserOperation[]): Promise<HexData32> {
        console.log("Bundle", entryPoint, ops)
        const ep = getContract({
            abi: EntryPointAbi,
            address: entryPoint,
            publicClient: this.publicClient,
            walletClient: this.walletClient
        })

        const gasLimit = await ep.estimateGas
            .handleOps([ops, this.beneficiary], {
                account: this.executeEOA
            })
            .then((limit) => {
                return (limit * 12n) / 10n
            })

        const tx = await ep.write.handleOps([ops, this.beneficiary], {
            gas: gasLimit,
            account: this.executeEOA,
            chain: this.walletClient.chain
        })

        return tx
    }
}
