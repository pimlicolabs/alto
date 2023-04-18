import { MongoClient, Collection, Filter } from "mongodb"
import { PublicClient, getContract } from "viem"
import { EntryPointAbi } from "../contracts/EntryPoint"
import { Address, UserOperation } from "../api/schemas"

export interface MempoolEntry {
    entrypointAddress: Address
    userOperation: UserOperation
    opHash: string
    status: UserOpStatus
    transactionHash?: string
}

enum UserOpStatus {
    Invalid = 0,
    NotIncluded = 1,
    Included = 2,
    Finalized = 3
}

// mempool per network
export abstract class Mempool {
    abstract currentSize(): Promise<number>
    abstract add(_entrypoint: string, _op: UserOperation): Promise<string> // return hash of userOperation
    abstract include(_entrypoint: string, _opHashes: string[], _txhash: string): void
    abstract finalize(_entrypoint: string, _opHashes: string[], _txhash: string): void
    abstract get(_hash: string): Promise<MempoolEntry | null>
    abstract getAll(): Promise<MempoolEntry[]>
    abstract clear(): void
    abstract getUserOpHash(_entrypoint: string, _op: UserOperation): Promise<string>
}

export class MongoDBMempool extends Mempool {
    private collection: Collection<MempoolEntry>
    private publicClient: PublicClient

    constructor(publicClient: PublicClient, mongoClient: MongoClient, dbName: string, collectionName: string) {
        super()
        this.publicClient = publicClient
        this.collection = mongoClient.db(dbName).collection(collectionName)
    }

    async currentSize(): Promise<number> {
        return this.collection.countDocuments()
    }

    async add(entrypointAddress: Address, userOperation: UserOperation): Promise<string> {
        const opHash = await this.getUserOpHash(entrypointAddress, userOperation)
        await this.collection.insertOne({
            userOperation,
            entrypointAddress,
            opHash,
            status: UserOpStatus.NotIncluded
        })
        return opHash
    }

    async include(entrypointAddress: Address, opHashes: string[], txhash: string): Promise<void> {
        const filter: Filter<MempoolEntry> = {
            opHash: { $in: opHashes },
            status: UserOpStatus.NotIncluded
        }
        await this.collection.updateMany(filter, {
            $set: { transactionHash: txhash, status: UserOpStatus.Included }
        })
    }

    async finalize(entrypointAddress: Address, opHashes: string[], txhash: string): Promise<void> {
        const filter: Filter<MempoolEntry> = {
            opHash: { $in: opHashes },
            status: UserOpStatus.Included
        }
        await this.collection.updateMany(filter, {
            $set: { transactionHash: txhash, status: UserOpStatus.Finalized }
        })
    }

    async get(hash: string): Promise<MempoolEntry | null> {
        return this.collection.findOne({
            opHash: hash
        }) as Promise<MempoolEntry | null>
    }

    async getAll(): Promise<MempoolEntry[]> {
        return this.collection.find().toArray() as Promise<MempoolEntry[]>
    }

    async clear(): Promise<void> {
        await this.collection.deleteMany({})
    }

    async getUserOpHash(entryPointAddress: Address, op: UserOperation): Promise<string> {
        // TODO this can be optimized by branching based on the entrypoint version
        const ep = getContract({
            abi: EntryPointAbi,
            address: entryPointAddress,
            publicClient: this.publicClient
        })

        return await ep.read.getUserOpHash([op])
    }
}
