import { UserOp } from "../userOp"
import { MongoClient, Collection, FilterQuery } from "mongodb"

export interface MempoolEntry {
    entrypoint: string
    userOp: UserOp
    transactionHash: string
    status: UserOpStatus
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
    abstract add(entrypoint: string, userOp: UserOp): Promise<string> // return hash of userOp
    abstract include(entrypoint: string, opHashes: string[], txhash: string): void
    abstract finalize(entrypoint: string, opHashes: string[], txhash: string): void
    abstract get(hash: string): Promise<MempoolEntry | null>
    abstract getAll(): Promise<MempoolEntry[]>
    abstract clear(): void
    abstract getUserOpHash(entrypoint: string, op: UserOp): Promise<string>
}

export class MongoDBMempool extends Mempool {
    private collection: Collection

    constructor(mongoClient: MongoClient, dbName: string, collectionName: string) {
        super()
        this.collection = mongoClient.db(dbName).collection(collectionName)
    }

    async currentSize(): Promise<number> {
        return this.collection.countDocuments()
    }

    async add(entrypoint: string, userOp: UserOp): Promise<string> {
        const opHash = this.getUserOpHash(entrypoint, userOp)
        await this.collection.insertOne({ ...userOp, entrypoint, opHash, status: UserOpStatus.NotIncluded })
        return opHash
    }

    async include(entrypoint: string, opHashes: string[], txhash: string): Promise<void> {
        const filter: FilterQuery<MempoolEntry> = { opHash: { $in: opHashes }, status: UserOpStatus.NotIncluded }
        await this.collection.updateMany(filter, { $set: { status: UserOpStatus.Included } })
    }

    async finalize(entrypoint: string, opHashes: string[], txhash: string): Promise<void> {
        const filter: FilterQuery<MempoolEntry> = { opHash: { $in: opHashes }, status: UserOpStatus.Included }
        await this.collection.updateMany(filter, { $set: { status: UserOpStatus.Finalized } })
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
        const ep = 
    }
}
