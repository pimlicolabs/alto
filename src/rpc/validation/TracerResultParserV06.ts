import {
    EntryPointV06Abi,
    PaymasterAbi,
    RpcError,
    SenderCreatorAbi,
    type StakeInfo,
    type StorageMap,
    type UserOperation06,
    ValidationErrors,
    type ValidationResult
} from "@alto/types"
import type { Abi, AbiFunction } from "abitype"
// This file contains references to validation rules, in the format [xxx-###]
// where xxx is OP/STO/COD/EP/SREP/EREP/UREP/ALT, and ### is a number
// the validation rules are defined in erc-aa-validation.md
import {
    type Address,
    type Hex,
    decodeErrorResult,
    decodeFunctionResult,
    getFunctionSelector,
    hexToBigInt,
    keccak256,
    pad
} from "viem"
import type { BundlerTracerResult } from "./BundlerCollectorTracerV06"

interface CallEntry {
    to: string
    from: string
    type: string // call opcode
    method: string // parsed method, or signash if unparsed
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    revert?: any // parsed output from REVERT
    // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
    return?: any // parsed method output.
    value?: Hex
}

type StakeInfoEntities = {
    factory?: StakeInfo
    account?: StakeInfo
    paymaster?: StakeInfo
}

const abi = [...SenderCreatorAbi, ...EntryPointV06Abi, ...PaymasterAbi] as Abi

// biome-ignore lint/suspicious/noExplicitAny: it's a generic type
const functionSignatureToMethodName = (hash: any) => {
    let functionName: string | undefined
    for (const item of abi) {
        const signature = getFunctionSelector(item as AbiFunction)
        if (signature === hash) {
            functionName = (item as AbiFunction).name
        }
    }

    if (functionName === undefined) {
        throw new Error(`Could not find function name for hash ${hash}`)
    }

    return functionName
}

/**
 * parse all call operation in the trace.
 * notes:
 * - entries are ordered by the return (so nested call appears before its outer call
 * - last entry is top-level return from "simulateValidation". it as ret and rettype, but no type or address
 * @param tracerResults
 * @param abi
 */
function parseCallStack(tracerResults: BundlerTracerResult): CallEntry[] {
    function callCatch<T, T1>(x: () => T, def: T1): T | T1 {
        try {
            return x()
        } catch (_) {
            return def
        }
    }

    const out: CallEntry[] = []
    const stack: any[] = []
    const filteredTracerResultCalls = tracerResults.calls.filter(
        (x) => !x.type.startsWith("depth")
    )

    for (const c of filteredTracerResultCalls) {
        if (c.type.match(/REVERT|RETURN/) !== null) {
            const top = stack.splice(-1)[0] ?? {
                type: "top",
                method: "validateUserOp"
            }
            // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
            const returnData: Hex = (c as any).data
            if (top.type.match(/CREATE/) !== null) {
                out.push({
                    to: top.to,
                    from: top.from,
                    type: top.type,
                    method: "",
                    return: `len=${returnData.length}`
                })
            } else {
                const method = callCatch(
                    () => functionSignatureToMethodName(top.method),
                    top.method
                )

                if (c.type === "REVERT") {
                    const parsedError = callCatch(
                        () => decodeErrorResult({ abi: abi, data: returnData }),
                        returnData
                    )
                    out.push({
                        to: top.to,
                        from: top.from,
                        type: top.type,
                        method: method,
                        value: top.value,
                        revert: parsedError
                    })
                } else {
                    const ret = callCatch(
                        () =>
                            decodeFunctionResult({
                                abi: abi,
                                functionName: method,
                                data: returnData
                            }),
                        returnData
                    )
                    out.push({
                        to: top.to,
                        from: top.from,
                        type: top.type,
                        value: top.value,
                        method: method,
                        return: ret
                    })
                }
            }
        } else {
            stack.push(c)
        }
    }

    // TODO: verify that stack is empty at the end.

    return out
}

/**
 * slots associated with each entity.
 * keccak( A || ...) is associated with "A"
 * removed rule: keccak( ... || ASSOC ) (for a previously associated hash) is also associated with "A"
 *
 * @param stakeInfoEntities stake info for (factory, account, paymaster). factory and paymaster can be null.
 * @param keccak array of buffers that were given to keccak in the transaction
 */
function parseEntitySlots(
    stakeInfoEntities: StakeInfoEntities,
    keccak: Hex[]
): {
    [addr: string]: Set<string>
} {
    // for each entity (sender, factory, paymaster), hold the valid slot addresses
    // valid: the slot was generated by keccak(entity || ...)
    const entitySlots: { [addr: string]: Set<string> } = {}

    for (const k of keccak) {
        const values = Object.values(stakeInfoEntities)
        for (const info of values) {
            const addr = info?.addr?.toLowerCase() as Hex
            if (!addr) {
                continue
            }

            const addrPadded = pad(addr).toLowerCase()
            if (!entitySlots[addr]) {
                entitySlots[addr] = new Set<string>()
            }

            const currentEntitySlots = entitySlots[addr]

            // valid slot: the slot was generated by keccak(entityAddr || ...)
            if (k.startsWith(addrPadded)) {
                currentEntitySlots.add(keccak256(k))
            }
            // disabled 2nd rule: .. or by keccak( ... || OWN) where OWN is previous allowed slot
            // if (k.length === 130 && currentEntitySlots.has(k.slice(-64))) {
            //   currentEntitySlots.add(value)
            // }
        }
    }

    return entitySlots
}

// method-signature for calls from entryPoint
const callsFromEntryPointMethodSigs: { [key: string]: string } = {
    factory: getFunctionSelector({
        inputs: [
            {
                internalType: "bytes",
                name: "initCode",
                type: "bytes"
            }
        ],
        name: "createSender",
        outputs: [
            {
                internalType: "address",
                name: "sender",
                type: "address"
            }
        ],
        stateMutability: "nonpayable",
        type: "function"
    }),
    account: getFunctionSelector({
        inputs: [
            {
                components: [
                    {
                        internalType: "address",
                        name: "sender",
                        type: "address"
                    },
                    {
                        internalType: "uint256",
                        name: "nonce",
                        type: "uint256"
                    },
                    {
                        internalType: "bytes",
                        name: "initCode",
                        type: "bytes"
                    },
                    {
                        internalType: "bytes",
                        name: "callData",
                        type: "bytes"
                    },
                    {
                        internalType: "uint256",
                        name: "callGasLimit",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "verificationGasLimit",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "preVerificationGas",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "maxFeePerGas",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "maxPriorityFeePerGas",
                        type: "uint256"
                    },
                    {
                        internalType: "bytes",
                        name: "paymasterAndData",
                        type: "bytes"
                    },
                    {
                        internalType: "bytes",
                        name: "signature",
                        type: "bytes"
                    }
                ],
                internalType: "struct UserOperation",
                name: "userOp",
                type: "tuple"
            },
            {
                internalType: "bytes32",
                name: "",
                type: "bytes32"
            },
            {
                internalType: "uint256",
                name: "missingAccountFunds",
                type: "uint256"
            }
        ],
        name: "validateUserOp",
        outputs: [
            {
                internalType: "uint256",
                name: "",
                type: "uint256"
            }
        ],
        stateMutability: "nonpayable",
        type: "function"
    }),
    paymaster: getFunctionSelector({
        inputs: [
            {
                components: [
                    {
                        internalType: "address",
                        name: "sender",
                        type: "address"
                    },
                    {
                        internalType: "uint256",
                        name: "nonce",
                        type: "uint256"
                    },
                    {
                        internalType: "bytes",
                        name: "initCode",
                        type: "bytes"
                    },
                    {
                        internalType: "bytes",
                        name: "callData",
                        type: "bytes"
                    },
                    {
                        internalType: "uint256",
                        name: "callGasLimit",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "verificationGasLimit",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "preVerificationGas",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "maxFeePerGas",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "maxPriorityFeePerGas",
                        type: "uint256"
                    },
                    {
                        internalType: "bytes",
                        name: "paymasterAndData",
                        type: "bytes"
                    },
                    {
                        internalType: "bytes",
                        name: "signature",
                        type: "bytes"
                    }
                ],
                internalType: "struct UserOperation",
                name: "userOp",
                type: "tuple"
            },
            {
                internalType: "bytes32",
                name: "userOpHash",
                type: "bytes32"
            },
            {
                internalType: "uint256",
                name: "maxCost",
                type: "uint256"
            }
        ],
        name: "validatePaymasterUserOp",
        outputs: [
            {
                internalType: "bytes",
                name: "context",
                type: "bytes"
            },
            {
                internalType: "uint256",
                name: "validationData",
                type: "uint256"
            }
        ],
        stateMutability: "nonpayable",
        type: "function"
    })
}

/**
 * parse collected simulation traces and revert if they break our rules
 * @param userOp the userOperation that was used in this simulation
 * @param tracerResults the tracer return value
 * @param validationResult output from simulateValidation
 * @param entryPoint the entryPoint that hosted the "simulatedValidation" traced call.
 * @return list of contract addresses referenced by this UserOp
 */
export function tracerResultParserV06(
    userOp: UserOperation06,
    tracerResults: BundlerTracerResult,
    validationResult: ValidationResult,
    entryPointAddress: Address
): [string[], StorageMap] {
    // todo: block access to no-code addresses (might need update to tracer)

    // opcodes from [OP-011]
    const bannedOpCodes = new Set([
        "GASPRICE",
        "GASLIMIT",
        "DIFFICULTY",
        "TIMESTAMP",
        "BASEFEE",
        "BLOCKHASH",
        "NUMBER",
        "SELFBALANCE",
        "BALANCE",
        "ORIGIN",
        "GAS",
        "CREATE",
        "COINBASE",
        "SELFDESTRUCT",
        "RANDOM",
        "PREVRANDAO",
        "INVALID"
    ])

    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    if (Object.values(tracerResults.callsFromEntryPoint).length < 1) {
        throw new Error(
            "Unexpected traceCall result: no calls from entrypoint."
        )
    }
    const callStack = parseCallStack(tracerResults)

    // [OP-052], [OP-053]
    const callInfoEntryPoint = callStack.find(
        (call) =>
            call.to === entryPointAddress &&
            call.from !== entryPointAddress &&
            call.method !== "0x" &&
            call.method !== "depositTo"
    )
    // [OP-054]
    if (callInfoEntryPoint) {
        throw new RpcError(
            `illegal call into EntryPoint during validation ${callInfoEntryPoint?.method}`,
            ValidationErrors.OpcodeValidation
        )
    }

    // [OP-061]
    const illegalNonZeroValueCall = callStack.find(
        (call) =>
            call.to !== entryPointAddress &&
            hexToBigInt(call.value ?? "0x0") !== 0n
    )

    if (illegalNonZeroValueCall) {
        throw new RpcError(
            "May not may CALL with value",
            ValidationErrors.OpcodeValidation
        )
    }

    const sender = userOp.sender.toLowerCase()
    // stake info per "number" level (factory, sender, paymaster)
    // we only use stake info if we notice a memory reference that require stake
    const stakeInfoEntities: StakeInfoEntities = {
        factory: validationResult.factoryInfo,
        account: validationResult.senderInfo,
        paymaster: validationResult.paymasterInfo
    }

    const entitySlots: { [addr: string]: Set<string> } = parseEntitySlots(
        stakeInfoEntities,
        tracerResults.keccak as Hex[]
    )

    for (const [title, entStakes] of Object.entries(stakeInfoEntities)) {
        const entityTitle = title as keyof StakeInfoEntities
        const entityAddr = (entStakes?.addr ?? "").toLowerCase()
        const currentNumLevel = tracerResults.callsFromEntryPoint.find(
            (info) =>
                info.topLevelMethodSig ===
                callsFromEntryPointMethodSigs[entityTitle]
        )
        if (!currentNumLevel) {
            if (entityTitle === "account") {
                // should never happen... only factory, paymaster are optional.
                throw new Error("missing trace into validateUserOp")
            }
            continue
        }
        const opcodes = currentNumLevel.opcodes
        const access = currentNumLevel.access

        // [OP-020]
        if (currentNumLevel.oog ?? false) {
            throw new RpcError(
                `${entityTitle} internally reverts on oog`,
                ValidationErrors.OpcodeValidation
            )
        }

        // opcodes from [OP-011]
        for (const opcode of Object.keys(opcodes)) {
            if (bannedOpCodes.has(opcode)) {
                throw new RpcError(
                    `${entityTitle} uses banned opcode: ${opcode}`,
                    ValidationErrors.OpcodeValidation
                )
            }
        }
        // [OP-031]
        if (entityTitle === "factory") {
            if ((opcodes.CREATE2 ?? 0) > 1) {
                throw new RpcError(
                    `${entityTitle} with too many CREATE2`,
                    ValidationErrors.OpcodeValidation
                )
            }
        } else if (opcodes.CREATE2) {
            throw new RpcError(
                `${entityTitle} uses banned opcode: CREATE2`,
                ValidationErrors.OpcodeValidation
            )
        }

        for (const [addr, { reads, writes }] of Object.entries(access)) {
            // testing read/write access on contract "addr"
            if (addr === sender) {
                // allowed to access sender's storage
                // [STO-010]
                continue
            }

            if (addr === entryPointAddress) {
                // ignore storage access on entryPoint (balance/deposit of entities.
                // we block them on method calls: only allowed to deposit, never to read
                continue
            }

            // return true if the given slot is associated with the given address, given the known keccak operations:
            // @param slot the SLOAD/SSTORE slot address we're testing
            // @param addr - the address we try to check for association with
            // @param reverseKeccak - a mapping we built for keccak values that contained the address
            function associatedWith(
                slot: string,
                addr: string,
                entitySlots: { [addr: string]: Set<string> }
            ): boolean {
                const addrPadded = pad(addr as Hex, {
                    size: 32
                }).toLowerCase()
                if (slot.toLowerCase() === addrPadded) {
                    return true
                }
                const k = entitySlots[addr]
                if (!k) {
                    return false
                }
                const slotN = hexToBigInt(slot as Hex)
                // scan all slot entries to check of the given slot is within a structure, starting at that offset.
                // assume a maximum size on a (static) structure size.
                for (const k1 of k.keys()) {
                    const kn = hexToBigInt(k1 as Hex)
                    if (slotN >= kn && slotN < kn + 128n) {
                        return true
                    }
                }
                return false
            }

            // scan all slots. find a referenced slot
            // at the end of the scan, we will check if the entity has stake, and report that slot if not.
            let requireStakeSlot: string | undefined

            const slots = [...Object.keys(writes), ...Object.keys(reads)]

            for (const slot of slots) {
                // slot associated with sender is allowed (e.g. token.balanceOf(sender)
                // but during initial UserOp (where there is an initCode), it is allowed only for staked entity
                if (associatedWith(slot, sender, entitySlots)) {
                    if (userOp.initCode.length > 2) {
                        // special case: account.validateUserOp is allowed to use assoc storage if factory is staked.
                        // [STO-022], [STO-021]
                        if (
                            !(
                                entityAddr === sender &&
                                isStaked(stakeInfoEntities.factory)
                            )
                        ) {
                            requireStakeSlot = slot
                        }
                    }
                } else if (associatedWith(slot, entityAddr, entitySlots)) {
                    // [STO-032]
                    // accessing a slot associated with entityAddr (e.g. token.balanceOf(paymaster)
                    requireStakeSlot = slot
                } else if (addr === entityAddr) {
                    // [STO-031]
                    // accessing storage member of entity itself requires stake.
                    requireStakeSlot = slot
                } else if (writes[slot] === undefined) {
                    // [STO-033]: staked entity have read-only access to any storage in non-entity contract.
                    requireStakeSlot = slot
                } else {
                    // accessing arbitrary storage of another contract is not allowed
                    const readWrite = Object.keys(writes).includes(addr)
                        ? "write to"
                        : "read from"

                    const message = `${entityTitle} has forbidden ${readWrite} ${nameAddr(
                        addr,
                        entityTitle
                    )} slot ${slot}`

                    throw new RpcError(
                        message,
                        ValidationErrors.OpcodeValidation,
                        {
                            [entityTitle]: entStakes?.addr
                        }
                    )
                }
            }

            // if addr is current account/paymaster/factory, then return that title
            // otherwise, return addr as-is
            function nameAddr(addr: string, currentEntity: string): string {
                const [title] =
                    Object.entries(stakeInfoEntities).find(
                        ([title, info]) =>
                            info?.addr?.toLowerCase() === addr.toLowerCase()
                    ) ?? []

                return title ?? addr
            }

            requireCondAndStake(
                requireStakeSlot !== undefined,
                entStakes,
                `unstaked ${entityTitle} accessed ${nameAddr(
                    addr,
                    entityTitle
                )} slot ${requireStakeSlot}`
            )
        }

        // [EREP-050]
        if (entityTitle === "paymaster") {
            const validatePaymasterUserOp = callStack.find(
                (call) =>
                    call.method === "validatePaymasterUserOp" &&
                    call.to === entityAddr
            )
            const context = validatePaymasterUserOp?.return
                ? validatePaymasterUserOp?.return[0]
                : undefined

            requireCondAndStake(
                context && context !== "0x",
                entStakes,
                "unstaked paymaster must not return context"
            )
        }

        // check if the given entity is staked
        function isStaked(entStake?: StakeInfo): boolean {
            return Boolean(
                entStake &&
                    entStake.stake >= 1n &&
                    entStake.unstakeDelaySec >= 1n
            )
        }

        // helper method: if condition is true, then entity must be staked.
        function requireCondAndStake(
            cond: boolean,
            entStake: StakeInfo | undefined,
            failureMessage: string
        ): void {
            if (!cond) {
                return
            }
            if (!entStake) {
                throw new Error(
                    `internal: ${entityTitle} not in userOp, but has storage accesses in ${JSON.stringify(
                        access
                    )}`
                )
            }
            if (!isStaked(entStake)) {
                throw new RpcError(
                    failureMessage,
                    ValidationErrors.OpcodeValidation,
                    {
                        [entityTitle]: entStakes?.addr
                    }
                )
            }

            // TODO: check real minimum stake values
        }

        // the only contract we allow to access before its deployment is the "sender" itself, which gets created.
        // biome-ignore lint/suspicious/noExplicitAny: it's a generic type
        let illegalZeroCodeAccess: any
        for (const addr of Object.keys(currentNumLevel.contractSize)) {
            // [OP-042]
            if (
                addr !== sender &&
                currentNumLevel.contractSize[addr].contractSize <= 2
            ) {
                illegalZeroCodeAccess = currentNumLevel.contractSize[addr]
                illegalZeroCodeAccess.address = addr
                break
            }
        }
        // [OP-041]
        if (illegalZeroCodeAccess) {
            throw new RpcError(
                `${entityTitle} accesses un-deployed contract address ${
                    illegalZeroCodeAccess?.address as string
                } with opcode ${illegalZeroCodeAccess?.opcode as string}`,
                ValidationErrors.OpcodeValidation
            )
        }

        let illegalEntryPointCodeAccess: string | undefined
        for (const addr of Object.keys(currentNumLevel.extCodeAccessInfo)) {
            if (addr === entryPointAddress) {
                illegalEntryPointCodeAccess =
                    currentNumLevel.extCodeAccessInfo[addr]
                break
            }
        }

        if (illegalEntryPointCodeAccess) {
            throw new RpcError(
                `${entityTitle} accesses EntryPoint contract address ${entryPointAddress} with opcode ${illegalEntryPointCodeAccess}`,
                ValidationErrors.OpcodeValidation
            )
        }
    }

    // return list of contract addresses by this UserOp. already known not to contain zero-sized addresses.
    const addresses = tracerResults.callsFromEntryPoint.flatMap((level) =>
        Object.keys(level.contractSize)
    )
    const storageMap: StorageMap = {}
    for (const level of tracerResults.callsFromEntryPoint) {
        for (const addr of Object.keys(level.access)) {
            storageMap[addr] = storageMap[addr] ?? level.access[addr].reads
        }
    }
    return [addresses, storageMap]
}
