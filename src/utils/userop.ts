import {
    EntryPointV06Abi,
    EntryPointV07Abi,
    type PackedUserOperation,
    type UserOperation,
    type UserOperationV06,
    type UserOperationV07,
    logSchema,
    receiptSchema,
    type UserOperationBundle,
    type UserOperationReceipt
} from "@alto/types"
import * as sentry from "@sentry/node"
import type { Logger } from "pino"
import {
    type Address,
    type Hex,
    type PublicClient,
    type TransactionReceipt,
    concat,
    decodeEventLog,
    encodeAbiParameters,
    getAddress,
    keccak256,
    pad,
    size,
    slice,
    toHex,
    zeroAddress,
    getAbiItem
} from "viem"
import { z } from "zod"
import { areAddressesEqual, getAuthorizationStateOverrides } from "./helpers"
import { entryPoint07Abi } from "viem/account-abstraction"

// Type predicate check if the UserOperation is V06.
export function isVersion06(
    operation: UserOperation
): operation is UserOperationV06 {
    return "initCode" in operation && "paymasterAndData" in operation
}

// Type predicate to check if the UserOperation is V07.
export function isVersion07(
    operation: UserOperation
): operation is UserOperationV07 {
    return "factory" in operation && "paymaster" in operation
}

// Type predicate to check if the UserOperation is V07.
export function isVersion08(
    operation: UserOperation,
    entryPointAddress: Address
): operation is UserOperationV07 {
    return entryPointAddress.startsWith("0x4337")
}

export function getInitCode(unpackedUserOperation: UserOperationV07) {
    return unpackedUserOperation.factory
        ? concat([
              unpackedUserOperation.factory === "0x7702"
                  ? pad(unpackedUserOperation.factory, {
                          dir: "right",
                          size: 20
                      })
                  : unpackedUserOperation.factory,
              unpackedUserOperation.factoryData || ("0x" as Hex)
          ])
        : "0x"
}

export function unPackInitCode(initCode: Hex) {
    if (initCode === "0x") {
        return {
            factory: null,
            factoryData: null
        }
    }

    return {
        factory: getAddress(slice(initCode, 0, 20)),
        factoryData: size(initCode) > 20 ? slice(initCode, 20) : null
    }
}

export function getAccountGasLimits(unpackedUserOperation: UserOperationV07) {
    return concat([
        pad(toHex(unpackedUserOperation.verificationGasLimit), {
            size: 16
        }),
        pad(toHex(unpackedUserOperation.callGasLimit), { size: 16 })
    ])
}

export function unpackAccountGasLimits(accountGasLimits: Hex) {
    return {
        verificationGasLimit: BigInt(slice(accountGasLimits, 0, 16)),
        callGasLimit: BigInt(slice(accountGasLimits, 16))
    }
}

export function getGasLimits(unpackedUserOperation: UserOperationV07) {
    return concat([
        pad(toHex(unpackedUserOperation.maxPriorityFeePerGas), {
            size: 16
        }),
        pad(toHex(unpackedUserOperation.maxFeePerGas), { size: 16 })
    ])
}

export function unpackGasLimits(gasLimits: Hex) {
    return {
        maxPriorityFeePerGas: BigInt(slice(gasLimits, 0, 16)),
        maxFeePerGas: BigInt(slice(gasLimits, 16))
    }
}

export function getPaymasterAndData(unpackedUserOperation: UserOperationV07) {
    return unpackedUserOperation.paymaster
        ? concat([
              unpackedUserOperation.paymaster,
              pad(
                  toHex(
                      unpackedUserOperation.paymasterVerificationGasLimit || 0n
                  ),
                  {
                      size: 16
                  }
              ),
              pad(toHex(unpackedUserOperation.paymasterPostOpGasLimit || 0n), {
                  size: 16
              }),
              unpackedUserOperation.paymasterData || ("0x" as Hex)
          ])
        : "0x"
}

export function unpackPaymasterAndData(paymasterAndData: Hex) {
    if (paymasterAndData === "0x") {
        return {
            paymaster: null,
            paymasterVerificationGasLimit: null,
            paymasterPostOpGasLimit: null,
            paymasterData: null
        }
    }

    const paymasterAndDataSize = size(paymasterAndData)

    return {
        paymaster: getAddress(slice(paymasterAndData, 0, 20)),
        paymasterVerificationGasLimit: BigInt(slice(paymasterAndData, 20, 36)),
        paymasterPostOpGasLimit: BigInt(slice(paymasterAndData, 36, 52)),
        paymasterData:
            paymasterAndDataSize > 52 ? slice(paymasterAndData, 52) : null
    }
}

export function toPackedUserOperation(
    unpackedUserOperation: UserOperationV07
): PackedUserOperation {
    return {
        sender: unpackedUserOperation.sender,
        nonce: unpackedUserOperation.nonce,
        initCode: getInitCode(unpackedUserOperation),
        callData: unpackedUserOperation.callData,
        accountGasLimits: getAccountGasLimits(unpackedUserOperation),
        preVerificationGas: unpackedUserOperation.preVerificationGas,
        gasFees: getGasLimits(unpackedUserOperation),
        paymasterAndData: getPaymasterAndData(unpackedUserOperation),
        signature: unpackedUserOperation.signature
    }
}

// biome-ignore lint/suspicious/noExplicitAny: it's a generic type
export function deepHexlify(obj: any): any {
    if (typeof obj === "function") {
        return undefined
    }
    if (obj == null || typeof obj === "string" || typeof obj === "boolean") {
        return obj
    }

    if (typeof obj === "bigint") {
        return toHex(obj)
    }

    if (obj._isBigNumber != null || typeof obj !== "object") {
        return toHex(obj).replace(/^0x0/, "0x")
    }
    if (Array.isArray(obj)) {
        return obj.map((member) => deepHexlify(member))
    }
    return Object.keys(obj).reduce(
        // biome-ignore lint/suspicious/noExplicitAny: it's a recursive function, so it's hard to type
        (set: any, key: string) => {
            set[key] = deepHexlify(obj[key])
            return set
        },
        {}
    )
}

export function getAddressFromInitCodeOrPaymasterAndData(
    data: Hex
): Address | null {
    if (!data) {
        return null
    }
    if (data.length >= 42) {
        return getAddress(data.slice(0, 42))
    }
    return null
}

type UserOperationDetailsType = {
    accountDeployed: boolean
    status: "succesful" | "calldata_phase_reverted"
    revertReason?: Hex
}

export type BundlingStatus =
    | {
          // The tx was successfully mined
          // The status of each userOperation is recorded in userOperaitonDetails
          status: "included"
          userOperationDetails: Record<Hex, UserOperationDetailsType>
      }
    | {
          // The tx reverted due to a op in the bundle failing EntryPoint validation
          status: "reverted"
      }
    | {
          // The tx could not be found (pending or invalid hash)
          status: "not_found"
      }

// Return the status of the bundling transaction.
export const getBundleStatus = async ({
    transactionHash,
    publicClient,
    bundle,
    logger
}: {
    transactionHash: Hex
    bundle: UserOperationBundle
    publicClient: PublicClient
    logger: Logger
}): Promise<{
    bundlingStatus: BundlingStatus
    blockNumber: bigint | undefined
}> => {
    try {
        const { entryPoint, version } = bundle
        const isVersion06 = version === "0.6"

        const receipt = await publicClient.getTransactionReceipt({
            hash: transactionHash
        })
        const blockNumber = receipt.blockNumber

        if (receipt.status === "reverted") {
            const bundlingStatus: {
                status: "reverted"
            } = {
                status: "reverted"
            }

            return { bundlingStatus, blockNumber }
        }

        const userOperationDetails = receipt.logs
            .filter((log) => areAddressesEqual(log.address, entryPoint))
            .reduce((result: Record<Hex, UserOperationDetailsType>, log) => {
                try {
                    const { data, topics } = log
                    const { eventName, args } = decodeEventLog({
                        abi: isVersion06 ? EntryPointV06Abi : EntryPointV07Abi,
                        data,
                        topics
                    })

                    if (
                        eventName === "AccountDeployed" ||
                        eventName === "UserOperationRevertReason" ||
                        eventName === "UserOperationEvent"
                    ) {
                        const opHash = args.userOpHash

                        // create result entry if doesn't exist
                        result[opHash] ??= {
                            accountDeployed: false,
                            status: "succesful"
                        }

                        switch (eventName) {
                            case "AccountDeployed": {
                                result[opHash].accountDeployed = true
                                break
                            }
                            case "UserOperationRevertReason": {
                                result[opHash].revertReason = args.revertReason
                                break
                            }
                            case "UserOperationEvent": {
                                const status = args.success
                                    ? "succesful"
                                    : "calldata_phase_reverted"
                                result[opHash].status = status
                                break
                            }
                        }
                    }
                } catch (e) {
                    sentry.captureException(e)
                }

                return result
            }, {})

        return {
            bundlingStatus: {
                status: "included",
                userOperationDetails
            },
            blockNumber
        }
    } catch {
        return {
            bundlingStatus: {
                status: "not_found"
            },
            blockNumber: undefined
        }
    }
}

export const getUserOperationHashV06 = ({
    userOperation,
    entryPointAddress,
    chainId
}: {
    userOperation: UserOperationV06
    entryPointAddress: Address
    chainId: number
}) => {
    const hash = keccak256(
        encodeAbiParameters(
            [
                {
                    name: "sender",
                    type: "address"
                },
                {
                    name: "nonce",
                    type: "uint256"
                },
                {
                    name: "initCodeHash",
                    type: "bytes32"
                },
                {
                    name: "callDataHash",
                    type: "bytes32"
                },
                {
                    name: "callGasLimit",
                    type: "uint256"
                },
                {
                    name: "verificationGasLimit",
                    type: "uint256"
                },
                {
                    name: "preVerificationGas",
                    type: "uint256"
                },
                {
                    name: "maxFeePerGas",
                    type: "uint256"
                },
                {
                    name: "maxPriorityFeePerGas",
                    type: "uint256"
                },
                {
                    name: "paymasterAndDataHash",
                    type: "bytes32"
                }
            ],
            [
                userOperation.sender,
                userOperation.nonce,
                keccak256(userOperation.initCode),
                keccak256(userOperation.callData),
                userOperation.callGasLimit,
                userOperation.verificationGasLimit,
                userOperation.preVerificationGas,
                userOperation.maxFeePerGas,
                userOperation.maxPriorityFeePerGas,
                keccak256(userOperation.paymasterAndData)
            ]
        )
    )

    return keccak256(
        encodeAbiParameters(
            [
                {
                    name: "userOpHash",
                    type: "bytes32"
                },
                {
                    name: "entryPointAddress",
                    type: "address"
                },
                {
                    name: "chainId",
                    type: "uint256"
                }
            ],
            [hash, entryPointAddress, BigInt(chainId)]
        )
    )
}

export const getUserOperationHashV07 = ({
    userOperation,
    entryPointAddress,
    chainId
}: {
    userOperation: PackedUserOperation
    entryPointAddress: Address
    chainId: number
}) => {
    const hash = keccak256(
        encodeAbiParameters(
            [
                {
                    name: "sender",
                    type: "address"
                },
                {
                    name: "nonce",
                    type: "uint256"
                },
                {
                    name: "initCodeHash",
                    type: "bytes32"
                },
                {
                    name: "callDataHash",
                    type: "bytes32"
                },
                {
                    name: "accountGasLimits",
                    type: "bytes32"
                },
                {
                    name: "preVerificationGas",
                    type: "uint256"
                },
                {
                    name: "gasFees",
                    type: "bytes32"
                },
                {
                    name: "paymasterAndDataHash",
                    type: "bytes32"
                }
            ],
            [
                userOperation.sender,
                userOperation.nonce,
                keccak256(userOperation.initCode),
                keccak256(userOperation.callData),
                userOperation.accountGasLimits,
                userOperation.preVerificationGas,
                userOperation.gasFees,
                keccak256(userOperation.paymasterAndData)
            ]
        )
    )

    return keccak256(
        encodeAbiParameters(
            [
                {
                    name: "userOpHash",
                    type: "bytes32"
                },
                {
                    name: "entryPointAddress",
                    type: "address"
                },
                {
                    name: "chainId",
                    type: "uint256"
                }
            ],
            [hash, entryPointAddress, BigInt(chainId)]
        )
    )
}

export const getUserOperationHashV08 = async ({
    userOperation,
    entryPointAddress,
    publicClient
}: {
    userOperation: UserOperationV07
    entryPointAddress: Address
    chainId: number
    publicClient: PublicClient
}) => {
    const packedUserOp = toPackedUserOperation(userOperation)

    // : concat(["0xef0100", code ?? "0x"])
    const stateOverrides = getAuthorizationStateOverrides({
        userOperations: [userOperation]
    })

    const hash = await publicClient.readContract({
        address: entryPointAddress,
        abi: [
            {
                inputs: [
                    {
                        components: [
                            { name: "sender", type: "address" },
                            { name: "nonce", type: "uint256" },
                            { name: "initCode", type: "bytes" },
                            { name: "callData", type: "bytes" },
                            { name: "accountGasLimits", type: "bytes32" },
                            { name: "preVerificationGas", type: "uint256" },
                            { name: "gasFees", type: "bytes32" },
                            { name: "paymasterAndData", type: "bytes" },
                            { name: "signature", type: "bytes" }
                        ],
                        name: "userOp",
                        type: "tuple"
                    }
                ],
                name: "getUserOpHash",
                outputs: [{ name: "", type: "bytes32" }],
                stateMutability: "view",
                type: "function"
            }
        ],
        functionName: "getUserOpHash",
        args: [packedUserOp],
        stateOverride: [
            ...Object.keys(stateOverrides).map((address) => ({
                address: address as Address,
                code: stateOverrides[address as Address]?.code ?? "0x"
            }))
        ]
    })

    return hash
}

export const getUserOperationHash = ({
    userOperation,
    entryPointAddress,
    chainId,
    publicClient
}: {
    userOperation: UserOperation
    entryPointAddress: Address
    chainId: number
    publicClient: PublicClient
}) => {
    if (isVersion06(userOperation)) {
        return getUserOperationHashV06({
            userOperation,
            entryPointAddress,
            chainId
        })
    }

    if (isVersion08(userOperation, entryPointAddress)) {
        return getUserOperationHashV08({
            userOperation,
            entryPointAddress,
            chainId,
            publicClient
        })
    }

    return getUserOperationHashV07({
        userOperation: toPackedUserOperation(userOperation),
        entryPointAddress,
        chainId
    })
}

export const getNonceKeyAndSequence = (nonce: bigint) => {
    const nonceKey = nonce >> 64n // first 192 bits of nonce
    const nonceSequence = nonce & 0xffffffffffffffffn // last 64 bits of nonce

    return [nonceKey, nonceSequence]
}

export function toUnpackedUserOperation(
    packedUserOperation: PackedUserOperation
): UserOperationV07 {
    const { factory, factoryData } = unPackInitCode(
        packedUserOperation.initCode
    )

    const { callGasLimit, verificationGasLimit } = unpackAccountGasLimits(
        packedUserOperation.accountGasLimits
    )

    const { maxFeePerGas, maxPriorityFeePerGas } = unpackGasLimits(
        packedUserOperation.gasFees
    )

    const {
        paymaster,
        paymasterVerificationGasLimit,
        paymasterPostOpGasLimit,
        paymasterData
    } = unpackPaymasterAndData(packedUserOperation.paymasterAndData)

    return {
        sender: packedUserOperation.sender,
        nonce: packedUserOperation.nonce,
        factory: factory,
        factoryData: factoryData,
        callData: packedUserOperation.callData,
        callGasLimit: callGasLimit,
        verificationGasLimit: verificationGasLimit,
        preVerificationGas: packedUserOperation.preVerificationGas,
        maxFeePerGas: maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        paymaster: paymaster,
        paymasterVerificationGasLimit: paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: paymasterPostOpGasLimit,
        paymasterData: paymasterData,
        signature: packedUserOperation.signature
    }
}

export function parseUserOperationReceipt(
    userOpHash: Hex,
    receipt: TransactionReceipt
) {
    let entryPoint: Address = zeroAddress
    let revertReason = undefined
    let userOpEventArgs:
        | {
              userOpHash: Hex
              sender: Address
              paymaster: Address
              nonce: bigint
              success: boolean
              actualGasCost: bigint
              actualGasUsed: bigint
          }
        | undefined = undefined

    let startIndex = -1
    let endIndex = -1

    for (let index = 0; index < receipt.logs.length; index++) {
        const log = receipt.logs[index]
        try {
            const { eventName, args } = decodeEventLog({
                abi: [
                    getAbiItem({
                        abi: entryPoint07Abi,
                        name: "UserOperationEvent"
                    }),
                    getAbiItem({
                        abi: entryPoint07Abi,
                        name: "BeforeExecution"
                    }),
                    getAbiItem({
                        abi: entryPoint07Abi,
                        name: "UserOperationRevertReason"
                    })
                ],
                data: log.data,
                topics: log.topics
            })

            if (eventName === "UserOperationEvent") {
                if (args.userOpHash === userOpHash) {
                    // it's our userOpHash. save as end of logs array
                    endIndex = index
                    entryPoint = log.address
                    userOpEventArgs = args
                } else if (endIndex === -1) {
                    // it's a different hash. remember it as beginning index, but only if we didn't find our end index yet.
                    startIndex = index
                }
            }

            if (eventName === "UserOperationRevertReason") {
                if (args.userOpHash === userOpHash) {
                    // it's our userOpHash. capture revert reason.
                    revertReason = args.revertReason
                }
            }
        } catch (e) {}
    }

    if (endIndex === -1 || !userOpEventArgs) {
        throw new Error("fatal: no UserOperationEvent in logs")
    }

    const filteredLogs = receipt.logs.slice(startIndex + 1, endIndex)

    const parsedLogs = z.array(logSchema).parse(filteredLogs)
    const parsedReceipt = receiptSchema.parse({
        ...receipt,
        status: receipt.status === "success" ? 1 : 0
    })

    const eventArgs = userOpEventArgs

    let paymaster: Address | undefined = eventArgs.paymaster
    if (paymaster === zeroAddress) {
        paymaster = undefined
    }

    const userOperationReceipt: UserOperationReceipt = {
        userOpHash,
        entryPoint,
        paymaster,
        sender: eventArgs.sender,
        nonce: eventArgs.nonce,
        actualGasUsed: eventArgs.actualGasUsed,
        actualGasCost: eventArgs.actualGasCost,
        success: eventArgs.success,
        reason: revertReason,
        logs: parsedLogs,
        receipt: parsedReceipt
    }

    return userOperationReceipt
}
