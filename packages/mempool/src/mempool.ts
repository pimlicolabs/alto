// import { MongoClient, Collection, Filter } from "mongodb"
// import { PublicClient, getContract } from "viem"
// import { EntryPointAbi } from "../types/EntryPoint"
import { Address, EntryPointAbi, UserOperation } from "@alto/types"
import { HexData32 } from "@alto/types"
import { PublicClient, getContract } from "viem"

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
export interface Mempool {
    currentSize(): Promise<number>
    add(_entrypoint: Address, _op: UserOperation): Promise<HexData32> // return hash of userOperation
    include(_opHashes: HexData32[], _txhash: HexData32): void
    finalize(_opHashes: HexData32[], _txhash: HexData32): void
    get(_hash: HexData32): Promise<MempoolEntry | null>
    getAll(): Promise<MempoolEntry[]>
    clear(): void
    getUserOpHash(_entrypoint: Address, _op: UserOperation): Promise<HexData32>
}

export class MemoryMempool implements Mempool {
    private mempool: Map<HexData32, MempoolEntry>
    private publicClient: PublicClient

    constructor(publicClient: PublicClient) {
        this.publicClient = publicClient
        this.mempool = new Map()
    }

    async currentSize(): Promise<number> {
        return this.mempool.size
    }

    async add(entrypointAddress: Address, userOperation: UserOperation): Promise<HexData32> {
        const opHash = await this.getUserOpHash(entrypointAddress, userOperation)
        this.mempool.set(opHash, {
            userOperation,
            entrypointAddress,
            opHash,
            status: UserOpStatus.NotIncluded
        })
        return opHash
    }

    async include(opHashes: HexData32[], txhash: HexData32): Promise<void> {
        opHashes.forEach(opHash => {
            const entry = this.mempool.get(opHash)
            if (entry && entry.status === UserOpStatus.NotIncluded) {
                entry.status = UserOpStatus.Included
                entry.transactionHash = txhash
            }
        })
    }

    async finalize(opHashes: HexData32[], txhash: HexData32): Promise<void> {
        opHashes.forEach(opHash => {
            const entry = this.mempool.get(opHash)
            if (entry && entry.status === UserOpStatus.Included) {
                entry.status = UserOpStatus.Finalized
                entry.transactionHash = txhash
            }
        })
    }

    async get(opHash: HexData32): Promise<MempoolEntry | null> {
        return this.mempool.get(opHash) || null
    }

    async getAll(): Promise<MempoolEntry[]> {
        return Array.from(this.mempool.values())
    }

    async clear(): Promise<void> {
        this.mempool.clear()
    }

    async getUserOpHash(entrypointAddress: Address, userOperation: UserOperation): Promise<HexData32> {
        const entrypoint = getContract({
            publicClient : this.publicClient,
            abi : EntryPointAbi,
            address : entrypointAddress
        })
        return entrypoint.read.getUserOpHash([userOperation])
    }
}
/*
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
*/
