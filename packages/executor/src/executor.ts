import { EntryPointAbi } from "@alto/types"
import { Address, HexData32, UserOperation } from "@alto/types"
import { Mutex } from "async-mutex"
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
    mutex : Mutex
    constructor(
        readonly beneficiary: Address,
        readonly publicClient: PublicClient,
        readonly walletClient: WalletClient,
        readonly executeEOA: Account
    ) {
        this.mutex = new Mutex()
    }

    async bundle(entryPoint: Address, ops: UserOperation[]): Promise<HexData32> {
        const initialHash = await this.mutex.runExclusive(async () => {
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
            this.monitorTx(tx).catch((e) => {
                console.error(e)
            })
            return tx
        })
        return initialHash
    }

    async monitorTx(tx: HexData32): Promise<void> {
        let transaction = await this.publicClient.getTransaction({
            hash: tx
        })
        let dismissed = false
        let checkedBlock : HexData32 = "0x0000000000000000000000000000000000000000000000000000000000000000"
        while(!dismissed) {
            console.log("get block")
            const block = await this.publicClient.getBlock({
                blockTag: "latest",
                includeTransactions: true
            })
            if(checkedBlock === block.hash!) {
                await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for new block
                continue
            } else {
                checkedBlock = block.hash!
            }
            const rcpt = await this.publicClient.getTransactionReceipt({
                hash: tx
            }).catch(() => undefined)
            if(rcpt !== undefined) {
                console.log("found")
                dismissed = true
                break
            }
            if(block.baseFeePerGas !== null && transaction.maxFeePerGas !== null && transaction.maxFeePerGas !== undefined && block.baseFeePerGas > transaction.maxFeePerGas) { // replace transaction
                const gasPrice = await this.publicClient.getGasPrice()
                tx = await this.walletClient.sendTransaction({
                    account: this.executeEOA,
                    chain: this.walletClient.chain,
                    to: transaction.to!,
                    value: transaction.value,
                    gas: transaction.gas,
                    data: transaction.input,
                    maxFeePerGas: gasPrice > transaction.maxFeePerGas * 11n / 10n ? gasPrice : transaction.maxFeePerGas * 11n / 10n,
                })
                transaction = await this.publicClient.getTransaction({
                    hash: tx
                })
                continue
            }
            await new Promise((resolve) => setTimeout(resolve, 1000)) // wait 1 second before checking again
        }
    }
}
