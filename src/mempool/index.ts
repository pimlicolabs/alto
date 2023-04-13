import { EntryPoint__factory } from "../contracts/generated/EntryPoint__factory"
import { UserOp } from "../userOp"
import { MongoClient, Collection, Filter } from "mongodb"
import { JsonRpcProvider } from "@ethersproject/providers"
import { EntryPoint } from "../contracts"

export interface MempoolEntry {
    entrypoint: string
    userOp: UserOp
    opHash: string
    status: UserOpStatus
    transactionHash?: string
}

enum UserOpStatus {
    Invalid = 0,
    NotIncluded = 1,
    Included = 2,
    Finalized = 3,
}

// mempool per network
export abstract class Mempool {
    abstract currentSize(): Promise<number>
    abstract add(_entrypoint: string, _userOp: UserOp): Promise<string> // return hash of userOp
    abstract include(_entrypoint: string, _opHashes: string[], _txhash: string): void
    abstract finalize(_entrypoint: string, _opHashes: string[], _txhash: string): void
    abstract get(_hash: string): Promise<MempoolEntry | null>
    abstract getAll(): Promise<MempoolEntry[]>
    abstract clear(): void
    abstract getUserOpHash(_entrypoint: string, _op: UserOp): Promise<string>
}

export class MongoDBMempool extends Mempool {
    private collection: Collection<MempoolEntry>
    provider: JsonRpcProvider

    constructor(provider: JsonRpcProvider, mongoClient: MongoClient, dbName: string, collectionName: string) {
        super()
        this.provider = provider
        this.collection = mongoClient.db(dbName).collection(collectionName)
    }

    async currentSize(): Promise<number> {
        return this.collection.countDocuments()
    }

    async add(entrypoint: string, userOp: UserOp): Promise<string> {
        const opHash = await this.getUserOpHash(entrypoint, userOp)
        await this.collection.insertOne({ userOp, entrypoint, opHash, status: UserOpStatus.NotIncluded })
        return opHash
    }

    async include(entrypoint: string, opHashes: string[], txhash: string): Promise<void> {
        const filter: Filter<MempoolEntry> = { opHash: { $in: opHashes }, status: UserOpStatus.NotIncluded }
        await this.collection.updateMany(filter, { $set: { transactionHash: txhash, status: UserOpStatus.Included } })
    }

    async finalize(entrypoint: string, opHashes: string[], txhash: string): Promise<void> {
        const filter: Filter<MempoolEntry> = { opHash: { $in: opHashes }, status: UserOpStatus.Included }
        await this.collection.updateMany(filter, { $set: { transactionHash: txhash, status: UserOpStatus.Finalized } })
    }

    async get(hash: string): Promise<MempoolEntry | null> {
        return this.collection.findOne({ opHash: hash }) as Promise<MempoolEntry | null>
    }

    async getAll(): Promise<MempoolEntry[]> {
        return this.collection.find().toArray() as Promise<MempoolEntry[]>
    }

    async clear(): Promise<void> {
        await this.collection.deleteMany({})
    }

    async getUserOpHash(entrypoint: string, op: UserOp): Promise<string> {
        // Your implementation here
        const ep: EntryPoint = EntryPoint__factory.connect(entrypoint, this.provider) // TODO this can be optimized by branching based on the entrypoint version
        return ep.getUserOpHash(op)
    }
}
