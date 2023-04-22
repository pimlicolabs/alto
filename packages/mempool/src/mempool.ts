// import { MongoClient, Collection, Filter } from "mongodb"
// import { PublicClient, getContract } from "viem"
// import { EntryPointAbi } from "../types/EntryPoint"
import { Address, EntryPointAbi, UserOperation } from "@alto/types"
import { HexData32 } from "@alto/types"
import { PublicClient, getContract } from "viem"
import { Mutex } from "async-mutex"

export interface MempoolEntry {
    entrypointAddress: Address
    userOperation: UserOperation
    opHash: string
    status: UserOpStatus
    transactionHash?: string
}

export enum UserOpStatus {
    Invalid = 0,
    Processing = 1,
    NotIncluded = 2,
    Included = 3,
    Finalized = 4
}

// mempool per network
export interface Mempool {
    currentSize(): Promise<number>
    add(_entrypoint: Address, _op: UserOperation): Promise<HexData32> // return hash of userOperation
    find(findFn: (entry: MempoolEntry) => boolean): Promise<Array<{ entry: MempoolEntry; opHash: HexData32 }>>
    markProcessed(_opHashes: HexData32[], updatedData: Partial<MempoolEntry>): Promise<void>
    get(_hash: HexData32): Promise<MempoolEntry | null>
    clear(): void
    getUserOpHash(_entrypoint: Address, _op: UserOperation): Promise<HexData32>
}

export class MemoryMempool implements Mempool {
    private mempool: Map<HexData32, MempoolEntry>
    private publicClient: PublicClient
    private mutex: Mutex

    constructor(publicClient: PublicClient) {
        this.publicClient = publicClient
        this.mempool = new Map()
        this.mutex = new Mutex()
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
    
    async markProcessed(
        opHashes: HexData32[],
        updatedData: Partial<MempoolEntry>
    ): Promise<void> {
        await this.mutex.acquire();
        try {
            for (const opHash of opHashes) {
                const entry = this.mempool.get(opHash);
                if (entry) {
                    // Make a copy of the updatedData object without the userOperation property
                    const { userOperation, ...safeUpdatedData } = updatedData;
                    Object.assign(entry, safeUpdatedData);
                }
                }
        } finally {
            this.mutex.release();
        }
    }

    async find(findFn: (entry: MempoolEntry) => boolean): Promise<Array<{ entry: MempoolEntry; opHash: HexData32 }>> {
        await this.mutex.acquire();
        try {
            const matchingEntries: Array<{ entry: MempoolEntry; opHash: HexData32 }> = [];
            for (const [opHash, entry] of this.mempool.entries()) {
                if (entry.status !== UserOpStatus.Processing && findFn(entry)) {
                    entry.status = UserOpStatus.Processing;
                    matchingEntries.push({ entry, opHash });
                }
            }
            return matchingEntries;
        } finally {
            this.mutex.release();
        }
    }
    
    async get(opHash: HexData32): Promise<MempoolEntry | null> {
        return this.mempool.get(opHash) || null
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