// biome-ignore lint/style/noNamespaceImport: explicitly make it clear when sentry is used
import type { StateOverrides } from "@alto/types"
import * as sentry from "@sentry/node"
import {
    type Account,
    type Chain,
    type PublicClient,
    type TransactionRequest,
    type Transport,
    type WalletClient,
    formatTransactionRequest
} from "viem"
// from:https://geth.ethereum.org/docs/rpc/ns-debug#javascript-based-tracing
//

/**
 * a function returning a LogTracer.
 * the function's body must be "{ return {...} }"
 * the body is executed as "geth" tracer, and thus must be self-contained (no external functions or references)
 * may only reference external functions defined by geth (see go-ethereum/eth/tracers/js): toHex, toWord, isPrecompiled, slice, toString(16)
 * (its OK if original function was in typescript: we extract its value as javascript
 */
type LogTracerFunc = () => LogTracer

// eslint-disable-next-line @typescript-eslint/naming-convention
export async function debug_traceCall(
    client: PublicClient | WalletClient,
    tx: TransactionRequest,
    options: TraceOptions & { stateOverrides?: StateOverrides }
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
): Promise<any> {
    const traceOptions = tracer2string(options)
    const ret = await client
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .request({
            method: "debug_traceCall",
            params: [formatTransactionRequest(tx), "latest", traceOptions]
        })
        .catch((e: unknown) => {
            if (e instanceof Error) {
                // console.log("ex=", e.message)
                // console.log(
                //     "tracer=",
                //     traceOptions.tracer
                //         ?.toString()
                //         .split("\n")
                //         .map((line, index) => `${index + 1}: ${line}`)
                //         .join("\n")
                // )
                throw e
            }
            sentry.captureException(e)
        })
    // console.log("ret=", ret)
    return ret
}

// a hack for network that doesn't have traceCall: mine the transaction, and use debug_traceTransaction
export function execAndTrace(
    _walletClient: WalletClient<Transport, Chain, Account>,
    _tx: TransactionRequest,
    _options: TraceOptions
): TraceResult {
    //const hash = await walletClient.sendTransaction(tx)
    throw new Error("not implemented")
    //return await debug_traceTransaction(walletClient, hash, options)
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export async function debug_traceTransaction(
    client: PublicClient | WalletClient,
    hash: string,
    options: TraceOptions
): Promise<TraceResult> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const ret = await client.request({
        method: "debug_traceTransaction",
        params: [hash, tracer2string(options)]
    })
    // const tx = await provider.getTransaction(hash)
    // return applyTracer(tx, ret, options)
    return ret
}

/**
 * extract the body of "LogTracerFunc".
 * note that we extract the javascript body, even if the function was created as typescript
 * @param func
 */
export function getTracerBodyString(func: LogTracerFunc): string {
    const tracerFunc = func.toString()
    // function must return a plain object:
    //  function xyz() { return {...}; }
    const regexp =
        /function \w+\s*\(\s*\)\s*{\s*return\s*(\{[\s\S]+\});?\s*\}\s*$/ // (\{[\s\S]+\}); \} $/
    const match = tracerFunc.match(regexp)

    if (match === null) {
        throw new Error("Not a simple method returning value")
    }
    let ret = match[1]
    ret = ret
        // .replace(/\/\/.*\n/g,'\n')
        // .replace(/\n\s*\n/g, '\n')
        .replace(/\b(?:const|let)\b/g, "")
    // console.log('== tracer source',ret.split('\n').map((line,index)=>`${index}: ${line}`).join('\n'))
    return ret
}

function tracer2string(options: TraceOptions): TraceOptions {
    if (typeof options.tracer === "function") {
        return {
            ...options,
            tracer: getTracerBodyString(options.tracer)
        }
    }
    return options
}

// the trace options param for debug_traceCall and debug_traceTransaction
export interface TraceOptions {
    disableStorage?: boolean // Setting this to true will disable storage capture (default = false).
    disableStack?: boolean // Setting this to true will disable stack capture (default = false).
    enableMemory?: boolean // Setting this to true will enable memory capture (default = false).
    enableReturnData?: boolean // Setting this to true will enable return data capture (default = false).
    tracer?: LogTracerFunc | string // Setting this will enable JavaScript-based transaction tracing, described below. If set, the previous four arguments will be ignored.
    timeout?: string // Overrides the default timeout of 5 seconds for JavaScript-based tracing calls. Valid time units are "ns", "us" (or "µs"), "ms", "s", "m", "h".
}

// the result type of debug_traceCall and debug_traceTransaction
export interface TraceResult {
    gas: number
    returnValue: string
    structLogs: [TraceResultEntry]
}

export interface TraceResultEntry {
    depth: number
    error: string
    gas: number
    gasCost: number
    memory?: [string]
    op: string
    pc: number
    stack: [string]
    storage?: [string]
}

export interface LogContext {
    type: string // one of the two values CALL and CREATE
    from: string // Address, sender of the transaction
    to: string // Address, target of the transaction
    input: Buffer // Buffer, input transaction data
    gas: number // Number, gas budget of the transaction
    gasUsed: number //  Number, amount of gas used in executing the transaction (excludes txdata costs)
    gasPrice: number // Number, gas price configured in the transaction being executed
    intrinsicGas: number // Number, intrinsic gas for the transaction being executed
    value: bigint // big.Int, amount to be transferred in wei
    block: number // Number, block number
    output: Buffer // Buffer, value returned from EVM
    time: string // String, execution runtime

    // And these fields are only available for tracing mined transactions (i.e. not available when doing debug_traceCall):
    blockHash?: Buffer // - Buffer, hash of the block that holds the transaction being executed
    txIndex?: number // - Number, index of the transaction being executed in the block
    txHash?: Buffer // - Buffer, hash of the transaction being executed
}

export interface LogTracer {
    // mandatory: result, fault
    // result is a function that takes two arguments ctx and db, and is expected to return
    // a JSON-serializable value to return to the RPC caller.
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    result: (ctx: LogContext, db: LogDb) => any

    // fault is a function that takes two arguments, log and db, just like step and is
    // invoked when an error happens during the execution of an opcode which wasn’t reported in step. The method log.getError() has information about the error.
    fault: (log: LogStep, db: LogDb) => void

    // optional (config is geth-level "cfg")
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    setup?: (config: any) => any

    // optional
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    step?: (log: LogStep, db: LogDb) => any

    // enter and exit must be present or omitted together.
    enter?: (frame: LogCallFrame) => void

    exit?: (frame: LogFrameResult) => void
}

export interface LogCallFrame {
    // - returns a string which has the type of the call frame
    getType: () => string
    // - returns the address of the call frame sender
    getFrom: () => string
    // - returns the address of the call frame target
    getTo: () => string
    // - returns the input as a buffer
    getInput: () => string
    // - returns a Number which has the amount of gas provided for the frame
    getGas: () => number
    // - returns a big.Int with the amount to be transferred only if available, otherwise undefined
    getValue: () => bigint
}

export interface LogFrameResult {
    getGasUsed: () => number // - returns amount of gas used throughout the frame as a Number
    getOutput: () => Buffer // - returns the output as a buffer
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    getError: () => any // - returns an error if one occurred during execution and undefined` otherwise
}

export interface LogOpCode {
    isPush: () => boolean // returns true if the opcode is a PUSHn
    toString: () => string // returns the string representation of the opcode
    toNumber: () => number // returns the opcode’s number
}

export interface LogMemory {
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    slice: (start: number, stop: number) => any // returns the specified segment of memory as a byte slice
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    getUint: (offset: number) => any // returns the 32 bytes at the given offset
    length: () => number // returns the memory size
}

export interface LogStack {
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    peek: (idx: number) => any // returns the idx-th element from the top of the stack (0 is the topmost element) as a big.Int
    length: () => number // returns the number of elements in the stack
}

export interface LogContract {
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    getCaller: () => any // returns the address of the caller
    getAddress: () => string // returns the address of the current contract
    getValue: () => bigint // returns the amount of value sent from caller to contract as a big.Int
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    getInput: () => any // returns the input data passed to the contract
}

export interface LogStep {
    op: LogOpCode // Object, an OpCode object representing the current opcode
    stack: LogStack // Object, a structure representing the EVM execution stack
    memory: LogMemory // Object, a structure representing the contract’s memory space
    contract: LogContract // Object, an object representing the account executing the current operation

    getPC: () => number // returns a Number with the current program counter
    getGas: () => number // returns a Number with the amount of gas remaining
    getCost: () => number // returns the cost of the opcode as a Number
    getDepth: () => number // returns the execution depth as a Number
    getRefund: () => number // returns the amount to be refunded as a Number
    getError: () => string | undefined //  returns information about the error if one occurred, otherwise returns undefined
    // If error is non-empty, all other fields should be ignored.
}

export interface LogDb {
    getBalance: (address: string) => bigint // - returns a big.Int with the specified account’s balance
    getNonce: (address: string) => number // returns a Number with the specified account’s nonce
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    getCode: (address: string) => any // returns a byte slice with the code for the specified account
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    getState: (address: string, hash: string) => any // returns the state value for the specified account and the specified hash
    exists: (address: string) => boolean // returns true if the specified address exists
}
