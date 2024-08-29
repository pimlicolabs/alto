import {
    EntryPointV06Abi,
    type UserOperationV06,
    type HexData32,
    type UserOperation,
    type UserOperationV07,
    EntryPointV07Abi,
    type PackedUserOperation
} from "@alto/types"
import * as sentry from "@sentry/node"
import {
    type Address,
    type Hex,
    type PublicClient,
    decodeEventLog,
    encodeAbiParameters,
    getAddress,
    keccak256,
    toHex,
    concat,
    slice,
    pad,
    decodeErrorResult,
    parseAbi
} from "viem"
import { areAddressesEqual } from "./helpers"
import type { Logger } from "pino"

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

export function getInitCode(unpackedUserOperation: UserOperationV07) {
    return unpackedUserOperation.factory
        ? concat([
              unpackedUserOperation.factory,
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
        factoryData: slice(initCode, 20)
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
    return {
        paymaster: getAddress(slice(paymasterAndData, 0, 20)),
        paymasterVerificationGasLimit: BigInt(slice(paymasterAndData, 20, 36)),
        paymasterPostOpGasLimit: BigInt(slice(paymasterAndData, 36, 52)),
        paymasterData: slice(paymasterAndData, 52)
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
          // biome-ignore lint/style/useNamingConvention: use double upper case for AA errors
          isAA95: boolean
          reason?: string
      }
    | {
          // The tx could not be found (pending or invalid hash)
          status: "not_found"
      }

// Return the status of the bundling transaction.
export const getBundleStatus = async (
    isVersion06: boolean,
    txHash: HexData32,
    publicClient: PublicClient,
    logger: Logger,
    entryPoint: Address
): Promise<{
    bundlingStatus: BundlingStatus
    blockNumber: bigint | undefined
}> => {
    try {
        const receipt = await publicClient.getTransactionReceipt({
            hash: txHash
        })

        const blockNumber = receipt.blockNumber

        if (receipt.status === "reverted") {
            const bundlingStatus: {
                status: "reverted"
                isAA95: boolean
                reason?: string
            } = {
                status: "reverted",
                isAA95: false
            }

            logger.info({ receipt }, "receipt")

            if ("error" in receipt) {
                try {
                    const match = (receipt.error as any).match(
                        /0x([a-fA-F0-9]+)?/
                    )

                    if (match) {
                        const revertReason = match[0] as Hex
                        const decoded = decodeErrorResult({
                            data: revertReason,
                            abi: parseAbi([
                                "error FailedOp(uint256 opIndex, string reason)"
                            ])
                        })

                        if (decoded.args[1] === "AA95 out of gas") {
                            bundlingStatus.isAA95 = true
                        }
                        bundlingStatus.reason = decoded.args[1]
                    }
                } catch (e) {
                    logger.error(
                        "Failed to decode userOperation revert reason due to ",
                        e
                    )
                }
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

export const getUserOperationHashV06 = (
    userOperation: UserOperationV06,
    entryPointAddress: Address,
    chainId: number
) => {
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

export const getUserOperationHashV07 = (
    userOperation: PackedUserOperation,
    entryPointAddress: Address,
    chainId: number
) => {
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

export const getUserOperationHash = (
    userOperation: UserOperation,
    entryPointAddress: Address,
    chainId: number
) => {
    if (isVersion06(userOperation)) {
        return getUserOperationHashV06(
            userOperation,
            entryPointAddress,
            chainId
        )
    }

    return getUserOperationHashV07(
        toPackedUserOperation(userOperation),
        entryPointAddress,
        chainId
    )
}

export const getNonceKeyAndValue = (nonce: bigint) => {
    const nonceKey = nonce >> 64n // first 192 bits of nonce
    const userOperationNonceValue = nonce & 0xffffffffffffffffn // last 64 bits of nonce

    return [nonceKey, userOperationNonceValue]
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

/*
 function pack(
        UserOperation calldata userOp
    ) internal pure returns (bytes memory ret) {
        address sender = getSender(userOp);
        uint256 nonce = userOp.nonce;
        bytes32 hashInitCode = calldataKeccak(userOp.initCode);
        bytes32 hashCallData = calldataKeccak(userOp.callData);
        uint256 callGasLimit = userOp.callGasLimit;
        uint256 verificationGasLimit = userOp.verificationGasLimit;
        uint256 preVerificationGas = userOp.preVerificationGas;
        uint256 maxFeePerGas = userOp.maxFeePerGas;
        uint256 maxPriorityFeePerGas = userOp.maxPriorityFeePerGas;
        bytes32 hashPaymasterAndData = calldataKeccak(userOp.paymasterAndData);

        return abi.encode(
            sender, nonce,
            hashInitCode, hashCallData,
            callGasLimit, verificationGasLimit, preVerificationGas,
            maxFeePerGas, maxPriorityFeePerGas,
            hashPaymasterAndData
        );
    }


    const encodedData = encodeAbiParameters(
  [
    { name: 'x', type: 'string' },
    { name: 'y', type: 'uint' },
    { name: 'z', type: 'bool' }
  ],
  ['wagmi', 420n, true]
)

*/
