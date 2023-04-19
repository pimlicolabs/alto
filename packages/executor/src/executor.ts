import { EntryPointAbi } from "@alto/types"
import { Mempool } from "@alto/mempool"
import { Address, HexData32, UserOperation } from "@alto/types"
import { PublicClient, WalletClient, getContract } from "viem"

export interface GasEstimateResult {
    preverificationGas: bigint
    verificationGasLimit: bigint
    callGasLimit: bigint
}

export abstract class Executor {
    entryPointAddress: Address
    mempool: Mempool
    beneficiary: Address
    publicClient: PublicClient
    walletClient: WalletClient

    constructor(
        entryPointAddress: Address,
        mempool: Mempool,
        beneficiary: Address,
        publicClient: PublicClient,
        walletClient: WalletClient
    ) {
        this.entryPointAddress = entryPointAddress
        this.mempool = mempool
        this.beneficiary = beneficiary
        this.publicClient = publicClient
        this.walletClient = walletClient
    }

    abstract bundle(_ops: UserOperation[]): Promise<HexData32>
}

export class BasicExecutor extends Executor {
    async bundle(ops: UserOperation[]): Promise<HexData32> {
        const ep = getContract({
            abi: EntryPointAbi,
            address: this.entryPointAddress,
            publicClient: this.publicClient,
            walletClient: this.walletClient
        })

        const gasLimit = await ep.estimateGas.handleOps([ops, this.beneficiary]).then((limit) => {
            return (limit * 12n) / 10n
        })

        const tx = await ep.write.handleOps([ops, this.beneficiary], {
            gas: gasLimit,
            account: this.beneficiary,
            chain: null
        })

        return tx
    }
}
