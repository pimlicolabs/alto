import { EntryPointAbi } from "@alto/types"
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
    // TODO Mutex
    constructor(
        readonly beneficiary: Address,
        readonly publicClient: PublicClient,
        readonly walletClient: WalletClient,
        readonly executeEOA: Account
    ) {}

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

        const tx = ep.write.handleOps([ops, this.beneficiary], {
            gas: gasLimit,
            account: this.executeEOA,
            chain: this.walletClient.chain
        })

        return tx
    }

    async monitorTx(tx: HexData32): Promise<void> {
        let transaction = await this.publicClient.getTransaction({
            hash: tx
        })
        let dismissed = false
        let checkedBlock : HexData32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
        while(!dismissed) {
            const block = await this.publicClient.getBlock({
                blockTag: "latest",
                includeTransactions: true
            })
            if(checkedBlock === block.hash!) {
                console.log("checked block")
                await new Promise((resolve) => setTimeout(resolve, 1000))
                continue;
            } else {
                checkedBlock = block.hash!;
            }
            console.log("=block", block)
            console.log("=tx", tx)
            setTimeout(
                async () => {transaction = await this.publicClient.getTransaction({
                    hash: tx
                })},
                1000
            ) // tx might be dropped from mempool and not found, anvil does not respond in this case
            console.log("=transaction", transaction)
            if(transaction.blockNumber !== null) {
                console.log("tx found")
                dismissed = true
                break
            }
            console.log("=baseFeePerGas", block.baseFeePerGas)
            console.log("=maxFeePerGas", transaction.maxFeePerGas)
            console.log("=compare", block.baseFeePerGas! > transaction.maxFeePerGas!)
            if(block.baseFeePerGas! > transaction.maxFeePerGas!) { // replace transaction
                console.log("replace tx")
                const gasPrice = await this.publicClient.getGasPrice();
                tx = await this.walletClient.sendTransaction({
                    account: this.executeEOA,
                    chain: this.walletClient.chain,
                    to: transaction.to!,
                    value: transaction.value,
                    gas: transaction.gas,
                    data: transaction.input,
                    maxFeePerGas: gasPrice > transaction.maxFeePerGas! * 11n / 10n ? gasPrice : transaction.maxFeePerGas! * 11n / 10n,
                })
            }
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }
    }
}
