// javascript code of tracer function
// NOTE: we process this locally for hardhat, but send to geth for remote tracing.
// should NOT "require" anything, or use logs.
// see LogTrace for valid types (but alas, this one must be javascript, not typescript).

// This file contains references to validation rules, in the format [xxx-###]
// where xxx is OP/STO/COD/EP/SREP/EREP/UREP/ALT, and ### is a number
// the validation rules are defined in erc-aa-validation.md

import type { Address, Hex } from "viem"
import type {
    LogCallFrame,
    LogContext,
    LogDb,
    LogFrameResult,
    LogStep,
    LogTracer
} from "./tracer"

// functions available in a context of geth tracer
// biome-ignore lint/suspicious/noExplicitAny: it's a generic type
declare function toHex(a: any): Hex

// biome-ignore lint/suspicious/noExplicitAny: it's a generic type
declare function toWord(a: any): string

// biome-ignore lint/suspicious/noExplicitAny: it's a generic type
declare function toAddress(a: any): string

/**
 * return type of our BundlerCollectorTracer.
 * collect access and opcodes, split into "levels" based on NUMBER opcode
 * keccak, calls and logs are collected globally, since the levels are unimportant for them.
 */
export interface BundlerTracerResult {
    /**
     * storage and opcode info, collected on top-level calls from EntryPoint
     */
    callsFromEntryPoint: TopLevelCallInfo[]

    /**
     * values passed into KECCAK opcode
     */
    keccak: Hex[]
    calls: Array<ExitInfo | MethodInfo>
    logs: LogInfo[]
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    debug: any[]
}

export interface MethodInfo {
    type: string
    from: Address
    to: Address
    method: string
    value: bigint
    gas: number
}

export interface ExitInfo {
    type: "REVERT" | "RETURN"
    gasUsed: number
    data: Hex
}

export interface TopLevelCallInfo {
    topLevelMethodSig: Hex
    topLevelTargetAddress: Address
    opcodes: { [opcode: string]: number }
    access: { [address: string]: AccessInfo }
    contractSize: { [addr: string]: ContractSizeInfo }
    extCodeAccessInfo: { [addr: string]: string }
    oog?: boolean
}

/**
 * It is illegal to access contracts with no code in validation even if it gets deployed later.
 * This means we need to store the {@link contractSize} of accessed addresses at the time of access.
 */
export interface ContractSizeInfo {
    opcode: string
    contractSize: number
}

export interface AccessInfo {
    // slot value, just prior this operation
    reads: { [slot: string]: string }
    // count of writes.
    writes: { [slot: string]: number }
}

export interface LogInfo {
    topics: string[]
    data: string
}

interface RelevantStepData {
    opcode: string
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    stackTop3: any[]
}

/**
 * type-safe local storage of our collector. contains all return-value properties.
 * (also defines all "trace-local" variables and functions)
 */
interface BundlerCollectorTracer extends LogTracer, BundlerTracerResult {
    lastOp: string
    lastThreeOpcodes: RelevantStepData[]
    stopCollectingTopic: string
    stopCollecting: boolean
    currentLevel: TopLevelCallInfo
    topLevelCallCounter: number
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    countSlot: (list: { [key: string]: number | undefined }, key: any) => void
}

/**
 * tracer to collect data for opcode banning.
 * this method is passed as the "tracer" for eth_traceCall (note, the function itself)
 *
 * returned data:
 *  numberLevels: opcodes and memory access, split on execution of "number" opcode.
 *  keccak: input data of keccak opcode.
 *  calls: for each call, an array of [type, from, to, value]
 *  slots: accessed slots (on any address)
 */
export function bundlerCollectorTracer(): BundlerCollectorTracer {
    return {
        callsFromEntryPoint: [],
        // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        currentLevel: null as any,
        keccak: [],
        calls: [],
        logs: [],
        debug: [],
        lastOp: "",
        lastThreeOpcodes: [],
        // event sent after all validations are done: keccak("BeforeExecution()")
        stopCollectingTopic:
            "bb47ee3e183a558b1a2ff0874b079f3fc5478b7454eacf2bfc5af2ff5878f972",
        stopCollecting: false,
        topLevelCallCounter: 0,

        fault(log: LogStep, _db: LogDb): void {
            this.debug.push(
                JSON.stringify({
                    type: "fault",
                    depth: log.getDepth(),
                    gas: log.getGas(),
                    cost: log.getCost(),
                    err: log.getError()
                })
            )
        },

        result(_ctx: LogContext, _db: LogDb): BundlerTracerResult {
            return {
                callsFromEntryPoint: this.callsFromEntryPoint,
                keccak: this.keccak,
                logs: this.logs,
                calls: this.calls,
                debug: this.debug // for internal debugging.
            }
        },

        enter(frame: LogCallFrame): void {
            if (this.stopCollecting) {
                return
            }
            this.calls.push({
                type: frame.getType(),
                from: toHex(frame.getFrom()),
                to: toHex(frame.getTo()),
                method: toHex(frame.getInput()).slice(0, 10),
                gas: frame.getGas(),
                value: frame.getValue()
            })
        },
        exit(frame: LogFrameResult): void {
            if (this.stopCollecting) {
                return
            }
            this.calls.push({
                type: frame.getError() != null ? "REVERT" : "RETURN",
                gasUsed: frame.getGasUsed(),
                data: toHex(frame.getOutput()).slice(0, 4000) as Hex
            })
        },

        // increment the "key" in the list. if the key is not defined yet, then set it to "1"
        // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        countSlot(list: { [key: string]: number | undefined }, key: any) {
            if (list[key]) {
                // @ts-ignore
                list[key] += 1
            } else {
                list[key] = 1
            }
        },
        // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        step(log: LogStep, db: LogDb): any {
            if (log.getDepth() < 3) {
                return
            }
            if (this.stopCollecting) {
                return
            }
            const opcode = log.op.toString()

            const stackSize = log.stack.length()
            const stackTop3 = []
            for (let i = 0; i < 3 && i < stackSize; i++) {
                stackTop3.push(log.stack.peek(i))
            }
            this.lastThreeOpcodes.push({ opcode, stackTop3 })
            if (this.lastThreeOpcodes.length > 3) {
                this.lastThreeOpcodes.shift()
            }

            if (
                log.getGas() < log.getCost() ||
                // special rule for SSTORE with gas metering
                (opcode === "SSTORE" && log.getGas() < 2300)
            ) {
                this.currentLevel.oog = true
            }

            if (opcode === "REVERT" || opcode === "RETURN") {
                if (log.getDepth() === 3) {
                    // exit() is not called on top-level return/revent, so we reconstruct it
                    // from opcode
                    const ofs = Number.parseInt(log.stack.peek(0).toString())
                    const len = Number.parseInt(log.stack.peek(1).toString())
                    const data = toHex(log.memory.slice(ofs, ofs + len)).slice(
                        0,
                        4000
                    ) as Hex
                    // this.debug.push(opcode + ' ' + data)
                    this.calls.push({
                        type: opcode,
                        gasUsed: 0,
                        data
                    })
                }
                // NOTE: flushing all history after RETURN
                this.lastThreeOpcodes = []
            }

            if (log.getDepth() === 3) {
                if (opcode === "CALL" || opcode === "STATICCALL") {
                    // stack.peek(0) - gas
                    const addr = toAddress(log.stack.peek(1).toString(16))
                    const topLevelTargetAddress = toHex(addr)
                    // stack.peek(2) - value
                    const ofs = Number.parseInt(log.stack.peek(3).toString())
                    // stack.peek(4) - len
                    const topLevelMethodSig = toHex(
                        log.memory.slice(ofs, ofs + 4)
                    )

                    this.currentLevel = this.callsFromEntryPoint[
                        this.topLevelCallCounter
                    ] = {
                        topLevelMethodSig,
                        topLevelTargetAddress,
                        access: {},
                        opcodes: {},
                        extCodeAccessInfo: {},
                        contractSize: {}
                    }
                    this.topLevelCallCounter++
                } else if (opcode === "LOG1") {
                    // ignore log data ofs, len
                    const topic = log.stack.peek(2).toString(16)
                    if (topic === this.stopCollectingTopic) {
                        this.stopCollecting = true
                    }
                }
                this.lastOp = ""
                return
            }

            const lastOpInfo =
                this.lastThreeOpcodes[this.lastThreeOpcodes.length - 2]
            // store all addresses touched by EXTCODE* opcodes
            if (
                lastOpInfo &&
                lastOpInfo.opcode &&
                lastOpInfo.opcode.match(/^(EXT.*)$/) != null
            ) {
                const addr = toAddress(lastOpInfo.stackTop3[0].toString(16))
                const addrHex = toHex(addr)

                // [OP-051]
                if (
                    !(
                        this.lastThreeOpcodes[0].opcode.match(/\w+/) !== null &&
                        this.lastThreeOpcodes[1].opcode === "EXTCODESIZE" &&
                        this.lastThreeOpcodes[2].opcode === "ISZERO"
                    )
                ) {
                    this.currentLevel.extCodeAccessInfo[addrHex] = opcode
                }
            }

            // not using 'isPrecompiled' to only allow the ones defined by the ERC-4337 as stateless precompiles
            // [OP-062]
            // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
            const isAllowedPrecompiled: (address: any) => boolean = (
                address
            ) => {
                const addrHex = toHex(address)
                const addressInt = Number.parseInt(addrHex)
                // this.debug.push(`isPrecompiled address=${addrHex} addressInt=${addressInt}`)
                return addressInt > 0 && addressInt < 10
            }

            // [OP-041]
            if (
                opcode.match(
                    /^(EXT.*|CALL|CALLCODE|DELEGATECALL|STATICCALL)$/
                ) != null
            ) {
                const idx = opcode.startsWith("EXT") ? 0 : 1
                const addr = toAddress(log.stack.peek(idx).toString(16))
                const addrHex = toHex(addr)
                // this.debug.push('op=' + opcode + ' last=' + this.lastOp + ' stacksize=' + log.stack.length() + ' addr=' + addrHex)
                if (
                    this.currentLevel.contractSize[addrHex] == null &&
                    !isAllowedPrecompiled(addr)
                ) {
                    this.currentLevel.contractSize[addrHex] = {
                        contractSize: db.getCode(addr).length,
                        opcode
                    }
                }
            }

            // [OP-012]
            if (this.lastOp === "GAS" && !opcode.includes("CALL")) {
                // count "GAS" opcode only if not followed by "CALL"
                this.countSlot(this.currentLevel.opcodes, "GAS")
            }
            if (opcode !== "GAS") {
                // ignore "unimportant" opcodes:
                if (
                    opcode.match(
                        /^(DUP\d+|PUSH\d+|SWAP\d+|POP|ADD|SUB|MUL|DIV|EQ|LTE?|S?GTE?|SLT|SH[LR]|AND|OR|NOT|ISZERO)$/
                    ) == null
                ) {
                    this.countSlot(this.currentLevel.opcodes, opcode)
                }
            }
            this.lastOp = opcode

            if (
                opcode === "SLOAD" ||
                opcode === "SSTORE" ||
                opcode === "TLOAD" ||
                opcode === "TSTORE"
            ) {
                const slot = toWord(log.stack.peek(0).toString(16))
                const slotHex = toHex(slot)
                const addr = log.contract.getAddress()
                const addrHex = toHex(addr)
                let access = this.currentLevel.access[addrHex]
                if (access == null) {
                    access = {
                        reads: {},
                        writes: {}
                    }
                    this.currentLevel.access[addrHex] = access
                }
                if (opcode === "SLOAD" || opcode === "TLOAD") {
                    // read slot values before this UserOp was created
                    // (so saving it if it was written before the first read)
                    if (
                        access.reads[slotHex] == null &&
                        access.writes[slotHex] == null
                    ) {
                        access.reads[slotHex] = toHex(db.getState(addr, slot))
                    }
                } else {
                    this.countSlot(access.writes, slotHex)
                }
            }

            if (opcode === "KECCAK256") {
                // collect keccak on 64-byte blocks
                const ofs = Number.parseInt(log.stack.peek(0).toString())
                const len = Number.parseInt(log.stack.peek(1).toString())
                // currently, solidity uses only 2-word (6-byte) for a key. this might change..
                // still, no need to return too much
                if (len > 20 && len < 512) {
                    // if (len === 64) {
                    this.keccak.push(toHex(log.memory.slice(ofs, ofs + len)))
                }
            } else if (opcode.startsWith("LOG")) {
                const count = Number.parseInt(opcode.substring(3))
                const ofs = Number.parseInt(log.stack.peek(0).toString())
                const len = Number.parseInt(log.stack.peek(1).toString())
                const topics = []
                for (let i = 0; i < count; i++) {
                    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
                    topics.push(`0x${log.stack.peek(2 + i).toString(16)}`)
                }
                const data = toHex(log.memory.slice(ofs, ofs + len))
                this.logs.push({
                    topics,
                    data
                })
            }
        }
    }
}
