export const EntryPointSimulationsAbi = [
    {
        inputs: [],
        stateMutability: "nonpayable",
        type: "constructor"
    },
    {
        inputs: [
            {
                internalType: "bool",
                name: "success",
                type: "bool"
            },
            {
                internalType: "bytes",
                name: "ret",
                type: "bytes"
            }
        ],
        name: "DelegateAndRevert",
        type: "error"
    },
    {
        inputs: [
            {
                internalType: "uint256",
                name: "opIndex",
                type: "uint256"
            },
            {
                internalType: "string",
                name: "reason",
                type: "string"
            }
        ],
        name: "FailedOp",
        type: "error"
    },
    {
        inputs: [
            {
                internalType: "uint256",
                name: "opIndex",
                type: "uint256"
            },
            {
                internalType: "string",
                name: "reason",
                type: "string"
            },
            {
                internalType: "bytes",
                name: "inner",
                type: "bytes"
            }
        ],
        name: "FailedOpWithRevert",
        type: "error"
    },
    {
        inputs: [
            {
                internalType: "bytes",
                name: "returnData",
                type: "bytes"
            }
        ],
        name: "PostOpReverted",
        type: "error"
    },
    {
        inputs: [],
        name: "ReentrancyGuardReentrantCall",
        type: "error"
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "sender",
                type: "address"
            }
        ],
        name: "SenderAddressResult",
        type: "error"
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "aggregator",
                type: "address"
            }
        ],
        name: "SignatureValidationFailed",
        type: "error"
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "bytes32",
                name: "userOpHash",
                type: "bytes32"
            },
            {
                indexed: true,
                internalType: "address",
                name: "sender",
                type: "address"
            },
            {
                indexed: false,
                internalType: "address",
                name: "factory",
                type: "address"
            },
            {
                indexed: false,
                internalType: "address",
                name: "paymaster",
                type: "address"
            }
        ],
        name: "AccountDeployed",
        type: "event"
    },
    {
        anonymous: false,
        inputs: [],
        name: "BeforeExecution",
        type: "event"
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "address",
                name: "account",
                type: "address"
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "totalDeposit",
                type: "uint256"
            }
        ],
        name: "Deposited",
        type: "event"
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "bytes32",
                name: "userOpHash",
                type: "bytes32"
            },
            {
                indexed: true,
                internalType: "address",
                name: "sender",
                type: "address"
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "nonce",
                type: "uint256"
            },
            {
                indexed: false,
                internalType: "bytes",
                name: "revertReason",
                type: "bytes"
            }
        ],
        name: "PostOpRevertReason",
        type: "event"
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "address",
                name: "aggregator",
                type: "address"
            }
        ],
        name: "SignatureAggregatorChanged",
        type: "event"
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "address",
                name: "account",
                type: "address"
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "totalStaked",
                type: "uint256"
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "unstakeDelaySec",
                type: "uint256"
            }
        ],
        name: "StakeLocked",
        type: "event"
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "address",
                name: "account",
                type: "address"
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "withdrawTime",
                type: "uint256"
            }
        ],
        name: "StakeUnlocked",
        type: "event"
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "address",
                name: "account",
                type: "address"
            },
            {
                indexed: false,
                internalType: "address",
                name: "withdrawAddress",
                type: "address"
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "amount",
                type: "uint256"
            }
        ],
        name: "StakeWithdrawn",
        type: "event"
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "bytes32",
                name: "userOpHash",
                type: "bytes32"
            },
            {
                indexed: true,
                internalType: "address",
                name: "sender",
                type: "address"
            },
            {
                indexed: true,
                internalType: "address",
                name: "paymaster",
                type: "address"
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "nonce",
                type: "uint256"
            },
            {
                indexed: false,
                internalType: "bool",
                name: "success",
                type: "bool"
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "actualGasCost",
                type: "uint256"
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "actualGasUsed",
                type: "uint256"
            }
        ],
        name: "UserOperationEvent",
        type: "event"
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "bytes32",
                name: "userOpHash",
                type: "bytes32"
            },
            {
                indexed: true,
                internalType: "address",
                name: "sender",
                type: "address"
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "nonce",
                type: "uint256"
            },
            {
                indexed: false,
                internalType: "bytes",
                name: "revertReason",
                type: "bytes"
            }
        ],
        name: "UserOperationRevertReason",
        type: "event"
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "address",
                name: "account",
                type: "address"
            },
            {
                indexed: false,
                internalType: "address",
                name: "withdrawAddress",
                type: "address"
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "amount",
                type: "uint256"
            }
        ],
        name: "Withdrawn",
        type: "event"
    },
    {
        inputs: [
            {
                internalType: "bytes",
                name: "initCode",
                type: "bytes"
            },
            {
                internalType: "address",
                name: "sender",
                type: "address"
            },
            {
                internalType: "bytes",
                name: "paymasterAndData",
                type: "bytes"
            }
        ],
        name: "_validateSenderAndPaymaster",
        outputs: [],
        stateMutability: "view",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "uint32",
                name: "unstakeDelaySec",
                type: "uint32"
            }
        ],
        name: "addStake",
        outputs: [],
        stateMutability: "payable",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "account",
                type: "address"
            }
        ],
        name: "balanceOf",
        outputs: [
            {
                internalType: "uint256",
                name: "",
                type: "uint256"
            }
        ],
        stateMutability: "view",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "target",
                type: "address"
            },
            {
                internalType: "bytes",
                name: "data",
                type: "bytes"
            }
        ],
        name: "delegateAndRevert",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "account",
                type: "address"
            }
        ],
        name: "depositTo",
        outputs: [],
        stateMutability: "payable",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "",
                type: "address"
            }
        ],
        name: "deposits",
        outputs: [
            {
                internalType: "uint256",
                name: "deposit",
                type: "uint256"
            },
            {
                internalType: "bool",
                name: "staked",
                type: "bool"
            },
            {
                internalType: "uint112",
                name: "stake",
                type: "uint112"
            },
            {
                internalType: "uint32",
                name: "unstakeDelaySec",
                type: "uint32"
            },
            {
                internalType: "uint48",
                name: "withdrawTime",
                type: "uint48"
            }
        ],
        stateMutability: "view",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "account",
                type: "address"
            }
        ],
        name: "getDepositInfo",
        outputs: [
            {
                components: [
                    {
                        internalType: "uint256",
                        name: "deposit",
                        type: "uint256"
                    },
                    {
                        internalType: "bool",
                        name: "staked",
                        type: "bool"
                    },
                    {
                        internalType: "uint112",
                        name: "stake",
                        type: "uint112"
                    },
                    {
                        internalType: "uint32",
                        name: "unstakeDelaySec",
                        type: "uint32"
                    },
                    {
                        internalType: "uint48",
                        name: "withdrawTime",
                        type: "uint48"
                    }
                ],
                internalType: "struct IStakeManager.DepositInfo",
                name: "info",
                type: "tuple"
            }
        ],
        stateMutability: "view",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "sender",
                type: "address"
            },
            {
                internalType: "uint192",
                name: "key",
                type: "uint192"
            }
        ],
        name: "getNonce",
        outputs: [
            {
                internalType: "uint256",
                name: "nonce",
                type: "uint256"
            }
        ],
        stateMutability: "view",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "bytes",
                name: "initCode",
                type: "bytes"
            }
        ],
        name: "getSenderAddress",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
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
                        internalType: "bytes32",
                        name: "accountGasLimits",
                        type: "bytes32"
                    },
                    {
                        internalType: "uint256",
                        name: "preVerificationGas",
                        type: "uint256"
                    },
                    {
                        internalType: "bytes32",
                        name: "gasFees",
                        type: "bytes32"
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
                internalType: "struct PackedUserOperation",
                name: "userOp",
                type: "tuple"
            }
        ],
        name: "getUserOpHash",
        outputs: [
            {
                internalType: "bytes32",
                name: "",
                type: "bytes32"
            }
        ],
        stateMutability: "view",
        type: "function"
    },
    {
        inputs: [
            {
                components: [
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
                                internalType: "bytes32",
                                name: "accountGasLimits",
                                type: "bytes32"
                            },
                            {
                                internalType: "uint256",
                                name: "preVerificationGas",
                                type: "uint256"
                            },
                            {
                                internalType: "bytes32",
                                name: "gasFees",
                                type: "bytes32"
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
                        internalType: "struct PackedUserOperation[]",
                        name: "userOps",
                        type: "tuple[]"
                    },
                    {
                        internalType: "contract IAggregator",
                        name: "aggregator",
                        type: "address"
                    },
                    {
                        internalType: "bytes",
                        name: "signature",
                        type: "bytes"
                    }
                ],
                internalType: "struct IEntryPoint.UserOpsPerAggregator[]",
                name: "opsPerAggregator",
                type: "tuple[]"
            },
            {
                internalType: "address payable",
                name: "beneficiary",
                type: "address"
            }
        ],
        name: "handleAggregatedOps",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
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
                        internalType: "bytes32",
                        name: "accountGasLimits",
                        type: "bytes32"
                    },
                    {
                        internalType: "uint256",
                        name: "preVerificationGas",
                        type: "uint256"
                    },
                    {
                        internalType: "bytes32",
                        name: "gasFees",
                        type: "bytes32"
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
                internalType: "struct PackedUserOperation[]",
                name: "ops",
                type: "tuple[]"
            },
            {
                internalType: "address payable",
                name: "beneficiary",
                type: "address"
            }
        ],
        name: "handleOps",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "uint192",
                name: "key",
                type: "uint192"
            }
        ],
        name: "incrementNonce",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "bytes",
                name: "callData",
                type: "bytes"
            },
            {
                components: [
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
                                internalType: "uint256",
                                name: "verificationGasLimit",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "callGasLimit",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "paymasterVerificationGasLimit",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "paymasterPostOpGasLimit",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "preVerificationGas",
                                type: "uint256"
                            },
                            {
                                internalType: "address",
                                name: "paymaster",
                                type: "address"
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
                            }
                        ],
                        internalType: "struct EntryPoint.MemoryUserOp",
                        name: "mUserOp",
                        type: "tuple"
                    },
                    {
                        internalType: "bytes32",
                        name: "userOpHash",
                        type: "bytes32"
                    },
                    {
                        internalType: "uint256",
                        name: "prefund",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "contextOffset",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "preOpGas",
                        type: "uint256"
                    }
                ],
                internalType: "struct EntryPoint.UserOpInfo",
                name: "opInfo",
                type: "tuple"
            },
            {
                internalType: "bytes",
                name: "context",
                type: "bytes"
            }
        ],
        name: "innerHandleOp",
        outputs: [
            {
                internalType: "uint256",
                name: "actualGasCost",
                type: "uint256"
            }
        ],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "",
                type: "address"
            },
            {
                internalType: "uint192",
                name: "",
                type: "uint192"
            }
        ],
        name: "nonceSequenceNumber",
        outputs: [
            {
                internalType: "uint256",
                name: "",
                type: "uint256"
            }
        ],
        stateMutability: "view",
        type: "function"
    },
    {
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
                        internalType: "bytes32",
                        name: "accountGasLimits",
                        type: "bytes32"
                    },
                    {
                        internalType: "uint256",
                        name: "preVerificationGas",
                        type: "uint256"
                    },
                    {
                        internalType: "bytes32",
                        name: "gasFees",
                        type: "bytes32"
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
                internalType: "struct PackedUserOperation",
                name: "op",
                type: "tuple"
            },
            {
                internalType: "address",
                name: "target",
                type: "address"
            },
            {
                internalType: "bytes",
                name: "targetCallData",
                type: "bytes"
            }
        ],
        name: "simulateHandleOp",
        outputs: [
            {
                components: [
                    {
                        internalType: "uint256",
                        name: "preOpGas",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "paid",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "accountValidationData",
                        type: "uint256"
                    },
                    {
                        internalType: "uint256",
                        name: "paymasterValidationData",
                        type: "uint256"
                    },
                    {
                        internalType: "bool",
                        name: "targetSuccess",
                        type: "bool"
                    },
                    {
                        internalType: "bytes",
                        name: "targetResult",
                        type: "bytes"
                    }
                ],
                internalType: "struct IEntryPointSimulations.ExecutionResult",
                name: "",
                type: "tuple"
            }
        ],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
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
                        internalType: "bytes32",
                        name: "accountGasLimits",
                        type: "bytes32"
                    },
                    {
                        internalType: "uint256",
                        name: "preVerificationGas",
                        type: "uint256"
                    },
                    {
                        internalType: "bytes32",
                        name: "gasFees",
                        type: "bytes32"
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
                internalType: "struct PackedUserOperation",
                name: "userOp",
                type: "tuple"
            }
        ],
        name: "simulateValidation",
        outputs: [
            {
                components: [
                    {
                        components: [
                            {
                                internalType: "uint256",
                                name: "preOpGas",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "prefund",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "accountValidationData",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "paymasterValidationData",
                                type: "uint256"
                            },
                            {
                                internalType: "bytes",
                                name: "paymasterContext",
                                type: "bytes"
                            }
                        ],
                        internalType: "struct IEntryPoint.ReturnInfo",
                        name: "returnInfo",
                        type: "tuple"
                    },
                    {
                        components: [
                            {
                                internalType: "uint256",
                                name: "stake",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "unstakeDelaySec",
                                type: "uint256"
                            }
                        ],
                        internalType: "struct IStakeManager.StakeInfo",
                        name: "senderInfo",
                        type: "tuple"
                    },
                    {
                        components: [
                            {
                                internalType: "uint256",
                                name: "stake",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "unstakeDelaySec",
                                type: "uint256"
                            }
                        ],
                        internalType: "struct IStakeManager.StakeInfo",
                        name: "factoryInfo",
                        type: "tuple"
                    },
                    {
                        components: [
                            {
                                internalType: "uint256",
                                name: "stake",
                                type: "uint256"
                            },
                            {
                                internalType: "uint256",
                                name: "unstakeDelaySec",
                                type: "uint256"
                            }
                        ],
                        internalType: "struct IStakeManager.StakeInfo",
                        name: "paymasterInfo",
                        type: "tuple"
                    },
                    {
                        components: [
                            {
                                internalType: "address",
                                name: "aggregator",
                                type: "address"
                            },
                            {
                                components: [
                                    {
                                        internalType: "uint256",
                                        name: "stake",
                                        type: "uint256"
                                    },
                                    {
                                        internalType: "uint256",
                                        name: "unstakeDelaySec",
                                        type: "uint256"
                                    }
                                ],
                                internalType: "struct IStakeManager.StakeInfo",
                                name: "stakeInfo",
                                type: "tuple"
                            }
                        ],
                        internalType: "struct IEntryPoint.AggregatorStakeInfo",
                        name: "aggregatorInfo",
                        type: "tuple"
                    }
                ],
                internalType: "struct IEntryPointSimulations.ValidationResult",
                name: "",
                type: "tuple"
            }
        ],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "bytes4",
                name: "interfaceId",
                type: "bytes4"
            }
        ],
        name: "supportsInterface",
        outputs: [
            {
                internalType: "bool",
                name: "",
                type: "bool"
            }
        ],
        stateMutability: "view",
        type: "function"
    },
    {
        inputs: [],
        name: "unlockStake",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "address payable",
                name: "withdrawAddress",
                type: "address"
            }
        ],
        name: "withdrawStake",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
        inputs: [
            {
                internalType: "address payable",
                name: "withdrawAddress",
                type: "address"
            },
            {
                internalType: "uint256",
                name: "withdrawAmount",
                type: "uint256"
            }
        ],
        name: "withdrawTo",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
        stateMutability: "payable",
        type: "receive"
    }
]

export const EntryPointSimulations_bytecode =
    "0x60a060405260405162000012906200009d565b604051809103906000f0801580156200002f573d6000803e3d6000fd5b506001600160a01b0390811660805260408051808201825260008082528251808401909352808352602080840191825282018390529051600380546001600160a01b031916919094161790925551600455516005553480156200009157600080fd5b506001600255620000ab565b610233806200525d83390190565b608051615199620000c4600039600050506151996000f3fe60806040526004361061016d5760003560e01c8063765e827f116100cb578063b760faf91161007f578063c3bce00911610059578063c3bce009146105ac578063dbed18e0146105d9578063fc7e286d146105f957600080fd5b8063b760faf914610564578063bb9fe6bf14610577578063c23a5cea1461058c57600080fd5b8063957122ab116100b0578063957122ab146104f757806397b2dcb9146105175780639b249f691461054457600080fd5b8063765e827f146104b7578063850aaf62146104d757600080fd5b8063205c28781161012257806335567e1a1161010757806335567e1a146102905780635287ce121461032557806370a082311461047457600080fd5b8063205c28781461025057806322cdde4c1461027057600080fd5b80630396cb60116101535780630396cb60146101e55780630bd28e3b146101f85780631b2e01b81461021857600080fd5b806242dc531461018257806301ffc9a7146101b557600080fd5b3661017d5761017b336106cb565b005b600080fd5b34801561018e57600080fd5b506101a261019d366004614129565b6106ec565b6040519081526020015b60405180910390f35b3480156101c157600080fd5b506101d56101d03660046141ef565b6108b9565b60405190151581526020016101ac565b61017b6101f3366004614231565b610a36565b34801561020457600080fd5b5061017b61021336600461427f565b610dcc565b34801561022457600080fd5b506101a261023336600461429a565b600160209081526000928352604080842090915290825290205481565b34801561025c57600080fd5b5061017b61026b3660046142cf565b610e14565b34801561027c57600080fd5b506101a261028b366004614314565b610fbe565b34801561029c57600080fd5b506101a26102ab36600461429a565b73ffffffffffffffffffffffffffffffffffffffff8216600090815260016020908152604080832077ffffffffffffffffffffffffffffffffffffffffffffffff8516845290915290819020549082901b7fffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000161792915050565b34801561033157600080fd5b50610412610340366004614349565b6040805160a0810182526000808252602082018190529181018290526060810182905260808101919091525073ffffffffffffffffffffffffffffffffffffffff1660009081526020818152604091829020825160a0810184528154815260019091015460ff811615159282019290925261010082046dffffffffffffffffffffffffffff16928101929092526f01000000000000000000000000000000810463ffffffff166060830152730100000000000000000000000000000000000000900465ffffffffffff16608082015290565b6040516101ac9190600060a082019050825182526020830151151560208301526dffffffffffffffffffffffffffff604084015116604083015263ffffffff606084015116606083015265ffffffffffff608084015116608083015292915050565b34801561048057600080fd5b506101a261048f366004614349565b73ffffffffffffffffffffffffffffffffffffffff1660009081526020819052604090205490565b3480156104c357600080fd5b5061017b6104d23660046143ab565b611000565b3480156104e357600080fd5b5061017b6104f2366004614402565b61117d565b34801561050357600080fd5b5061017b610512366004614457565b611222565b34801561052357600080fd5b506105376105323660046144dc565b61137a565b6040516101ac91906145ac565b34801561055057600080fd5b5061017b61055f3660046145fb565b6114c6565b61017b610572366004614349565b6106cb565b34801561058357600080fd5b5061017b6115b1565b34801561059857600080fd5b5061017b6105a7366004614349565b611791565b3480156105b857600080fd5b506105cc6105c7366004614314565b611a7e565b6040516101ac919061463d565b3480156105e557600080fd5b5061017b6105f43660046143ab565b611d82565b34801561060557600080fd5b50610681610614366004614349565b6000602081905290815260409020805460019091015460ff81169061010081046dffffffffffffffffffffffffffff16906f01000000000000000000000000000000810463ffffffff1690730100000000000000000000000000000000000000900465ffffffffffff1685565b6040805195865293151560208601526dffffffffffffffffffffffffffff9092169284019290925263ffffffff909116606083015265ffffffffffff16608082015260a0016101ac565b60015b60058110156106df576001016106ce565b6106e88261222e565b5050565b6000805a9050333014610760576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601760248201527f4141393220696e7465726e616c2063616c6c206f6e6c7900000000000000000060448201526064015b60405180910390fd5b8451606081015160a082015181016127100160405a603f02816107855761078561471d565b0410156107b6577fdeaddead0000000000000000000000000000000000000000000000000000000060005260206000fd5b8751600090156108575760006107d3846000015160008c86612284565b9050806108555760006107e761080061229c565b80519091501561084f57846000015173ffffffffffffffffffffffffffffffffffffffff168a602001517f1c4fada7374c0a9ee8841fc38afe82932dc0f8e69012e927f061a8bae611a20187602001518460405161084692919061474c565b60405180910390a35b60019250505b505b600088608001515a86030190506108a96000838b8b8b8080601f0160208091040260200160405190810160405280939291908181526020018383808284376000920191909152508892506122c8915050565b955050505050505b949350505050565b60007fffffffff0000000000000000000000000000000000000000000000000000000082167f60fc6b6e00000000000000000000000000000000000000000000000000000000148061094c57507fffffffff0000000000000000000000000000000000000000000000000000000082167f915074d800000000000000000000000000000000000000000000000000000000145b8061099857507fffffffff0000000000000000000000000000000000000000000000000000000082167fcf28ef9700000000000000000000000000000000000000000000000000000000145b806109e457507fffffffff0000000000000000000000000000000000000000000000000000000082167f3e84f02100000000000000000000000000000000000000000000000000000000145b80610a3057507f01ffc9a7000000000000000000000000000000000000000000000000000000007fffffffff000000000000000000000000000000000000000000000000000000008316145b92915050565b33600090815260208190526040902063ffffffff8216610ab2576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601a60248201527f6d757374207370656369667920756e7374616b652064656c61790000000000006044820152606401610757565b600181015463ffffffff6f0100000000000000000000000000000090910481169083161015610b3d576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601c60248201527f63616e6e6f7420646563726561736520756e7374616b652074696d65000000006044820152606401610757565b6001810154600090610b6590349061010090046dffffffffffffffffffffffffffff16614794565b905060008111610bd1576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601260248201527f6e6f207374616b652073706563696669656400000000000000000000000000006044820152606401610757565b6dffffffffffffffffffffffffffff811115610c49576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152600e60248201527f7374616b65206f766572666c6f770000000000000000000000000000000000006044820152606401610757565b6040805160a08101825283548152600160208083018281526dffffffffffffffffffffffffffff86811685870190815263ffffffff8a811660608801818152600060808a0181815233808352828a52918c90209a518b55965199909801805494519151965165ffffffffffff16730100000000000000000000000000000000000000027fffffffffffffff000000000000ffffffffffffffffffffffffffffffffffffff979094166f0100000000000000000000000000000002969096167fffffffffffffff00000000000000000000ffffffffffffffffffffffffffffff91909516610100027fffffffffffffffffffffffffffffffffff0000000000000000000000000000ff991515999099167fffffffffffffffffffffffffffffffffff00000000000000000000000000000090941693909317979097179190911691909117179055835185815290810192909252917fa5ae833d0bb1dcd632d98a8b70973e8516812898e19bf27b70071ebc8dc52c01910160405180910390a2505050565b33600090815260016020908152604080832077ffffffffffffffffffffffffffffffffffffffffffffffff851684529091528120805491610e0c836147a7565b919050555050565b3360009081526020819052604090208054821115610e8e576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601960248201527f576974686472617720616d6f756e7420746f6f206c61726765000000000000006044820152606401610757565b8054610e9b9083906147df565b81556040805173ffffffffffffffffffffffffffffffffffffffff851681526020810184905233917fd1c19fbcd4551a5edfb66d43d2e337c04837afda3482b42bdf569a8fccdae5fb910160405180910390a260008373ffffffffffffffffffffffffffffffffffffffff168360405160006040518083038185875af1925050503d8060008114610f48576040519150601f19603f3d011682016040523d82523d6000602084013e610f4d565b606091505b5050905080610fb8576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601260248201527f6661696c656420746f20776974686472617700000000000000000000000000006044820152606401610757565b50505050565b6000610fc982612582565b6040805160208101929092523090820152466060820152608001604051602081830303815290604052805190602001209050919050565b61100861259b565b8160008167ffffffffffffffff81111561102457611024613ebc565b60405190808252806020026020018201604052801561105d57816020015b61104a613d10565b8152602001906001900390816110425790505b50905060005b828110156110d657600082828151811061107f5761107f6147f2565b602002602001015190506000806110ba848a8a878181106110a2576110a26147f2565b90506020028101906110b49190614821565b856125dc565b915091506110cb8483836000612848565b505050600101611063565b506040516000907fbb47ee3e183a558b1a2ff0874b079f3fc5478b7454eacf2bfc5af2ff5878f972908290a160005b838110156111605761115481888884818110611123576111236147f2565b90506020028101906111359190614821565b858481518110611147576111476147f2565b6020026020010151612a9d565b90910190600101611105565b5061116b8482612e09565b5050506111786001600255565b505050565b6000808473ffffffffffffffffffffffffffffffffffffffff1684846040516111a792919061485f565b600060405180830381855af49150503d80600081146111e2576040519150601f19603f3d011682016040523d82523d6000602084013e6111e7565b606091505b509150915081816040517f9941055400000000000000000000000000000000000000000000000000000000815260040161075792919061486f565b83158015611245575073ffffffffffffffffffffffffffffffffffffffff83163b155b156112ac576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601960248201527f41413230206163636f756e74206e6f74206465706c6f796564000000000000006044820152606401610757565b6014811061133e5760006112c3601482848661488a565b6112cc916148b4565b60601c9050803b60000361133c576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601b60248201527f41413330207061796d6173746572206e6f74206465706c6f79656400000000006044820152606401610757565b505b6040517f08c379a00000000000000000000000000000000000000000000000000000000081526020600482015260006024820152604401610757565b6113b56040518060c0016040528060008152602001600081526020016000815260200160008152602001600015158152602001606081525090565b6113bd61259b565b6113c5613d10565b6113ce86612f50565b6000806113dd600089856125dc565b9150915060006113ef60008a86612a9d565b90506000606073ffffffffffffffffffffffffffffffffffffffff8a1615611481578973ffffffffffffffffffffffffffffffffffffffff16898960405161143892919061485f565b6000604051808303816000865af19150503d8060008114611475576040519150601f19603f3d011682016040523d82523d6000602084013e61147a565b606091505b5090925090505b6040518060c001604052808760800151815260200184815260200186815260200185815260200183151581526020018281525096505050505050506108b16001600255565b60006114e760065473ffffffffffffffffffffffffffffffffffffffff1690565b73ffffffffffffffffffffffffffffffffffffffff1663570e1a3684846040518363ffffffff1660e01b8152600401611521929190614945565b6020604051808303816000875af1158015611540573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906115649190614959565b6040517f6ca7b80600000000000000000000000000000000000000000000000000000000815273ffffffffffffffffffffffffffffffffffffffff82166004820152909150602401610757565b336000908152602081905260408120600181015490916f0100000000000000000000000000000090910463ffffffff169003611649576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152600a60248201527f6e6f74207374616b6564000000000000000000000000000000000000000000006044820152606401610757565b600181015460ff166116b7576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601160248201527f616c726561647920756e7374616b696e670000000000000000000000000000006044820152606401610757565b60018101546000906116e2906f01000000000000000000000000000000900463ffffffff1642614976565b6001830180547fffffffffffffff000000000000ffffffffffffffffffffffffffffffffffff001673010000000000000000000000000000000000000065ffffffffffff84169081027fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00169190911790915560405190815290915033907ffa9b3c14cc825c412c9ed81b3ba365a5b459439403f18829e572ed53a4180f0a906020015b60405180910390a25050565b336000908152602081905260409020600181015461010090046dffffffffffffffffffffffffffff1680611821576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601460248201527f4e6f207374616b6520746f2077697468647261770000000000000000000000006044820152606401610757565b6001820154730100000000000000000000000000000000000000900465ffffffffffff166118ab576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601d60248201527f6d7573742063616c6c20756e6c6f636b5374616b6528292066697273740000006044820152606401610757565b60018201544273010000000000000000000000000000000000000090910465ffffffffffff161115611939576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601b60248201527f5374616b65207769746864726177616c206973206e6f742064756500000000006044820152606401610757565b6001820180547fffffffffffffff000000000000000000000000000000000000000000000000ff1690556040805173ffffffffffffffffffffffffffffffffffffffff851681526020810183905233917fb7c918e0e249f999e965cafeb6c664271b3f4317d296461500e71da39f0cbda3910160405180910390a260008373ffffffffffffffffffffffffffffffffffffffff168260405160006040518083038185875af1925050503d8060008114611a0e576040519150601f19603f3d011682016040523d82523d6000602084013e611a13565b606091505b5050905080610fb8576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601860248201527f6661696c656420746f207769746864726177207374616b6500000000000000006044820152606401610757565b611a86613dc2565b611a8e613d10565b611a9783612f50565b600080611aa6600086856125dc565b845160e001516040805180820182526000808252602080830182815273ffffffffffffffffffffffffffffffffffffffff95861683528282528483206001908101546dffffffffffffffffffffffffffff6101008083048216885263ffffffff6f010000000000000000000000000000009384900481169095528e51518951808b018b5288815280880189815291909b168852878752898820909401549081049091168952049091169052835180850190945281845283015293955091935090366000611b7660408b018b61499c565b909250905060006014821015611b8d576000611ba8565b611b9b60146000848661488a565b611ba4916148b4565b60601c5b6040805180820182526000808252602080830182815273ffffffffffffffffffffffffffffffffffffffff86168352908290529290206001015461010081046dffffffffffffffffffffffffffff1682526f01000000000000000000000000000000900463ffffffff169091529091509350505050600085905060006040518060a001604052808960800151815260200189604001518152602001888152602001878152602001611c5a8a6060015190565b905260408051808201825260035473ffffffffffffffffffffffffffffffffffffffff908116825282518084019093526004548352600554602084810191909152820192909252919250831615801590611ccb575060018373ffffffffffffffffffffffffffffffffffffffff1614155b15611d4f5760408051808201825273ffffffffffffffffffffffffffffffffffffffff851680825282518084018452600080825260208083018281529382528181529490206001015461010081046dffffffffffffffffffffffffffff1682526f01000000000000000000000000000000900463ffffffff16909152909182015290505b6040805160a081018252928352602083019590955293810192909252506060810192909252608082015295945050505050565b611d8a61259b565b816000805b82811015611f7c5736868683818110611daa57611daa6147f2565b9050602002810190611dbc9190614a01565b9050366000611dcb8380614a35565b90925090506000611de26040850160208601614349565b90507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff73ffffffffffffffffffffffffffffffffffffffff821601611e83576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601760248201527f4141393620696e76616c69642061676772656761746f720000000000000000006044820152606401610757565b73ffffffffffffffffffffffffffffffffffffffff811615611f605773ffffffffffffffffffffffffffffffffffffffff8116632dd811338484611eca604089018961499c565b6040518563ffffffff1660e01b8152600401611ee99493929190614bed565b60006040518083038186803b158015611f0157600080fd5b505afa925050508015611f12575060015b611f60576040517f86a9f75000000000000000000000000000000000000000000000000000000000815273ffffffffffffffffffffffffffffffffffffffff82166004820152602401610757565b611f6a8287614794565b95505060019093019250611d8f915050565b5060008167ffffffffffffffff811115611f9857611f98613ebc565b604051908082528060200260200182016040528015611fd157816020015b611fbe613d10565b815260200190600190039081611fb65790505b5090506000805b848110156120ae5736888883818110611ff357611ff36147f2565b90506020028101906120059190614a01565b90503660006120148380614a35565b9092509050600061202b6040850160208601614349565b90508160005b8181101561209c57600089898151811061204d5761204d6147f2565b602002602001015190506000806120708b8989878181106110a2576110a26147f2565b9150915061208084838389612848565b8a61208a816147a7565b9b505060019093019250612031915050565b505060019094019350611fd892505050565b506040517fbb47ee3e183a558b1a2ff0874b079f3fc5478b7454eacf2bfc5af2ff5878f97290600090a150600080805b858110156121e957368989838181106120f9576120f96147f2565b905060200281019061210b9190614a01565b905061211d6040820160208301614349565b73ffffffffffffffffffffffffffffffffffffffff167f575ff3acadd5ab348fe1855e217e0f3678f8d767d7494c9f9fefbee2e17cca4d60405160405180910390a236600061216c8380614a35565b90925090508060005b818110156121d8576121b788858584818110612193576121936147f2565b90506020028101906121a59190614821565b8b8b81518110611147576111476147f2565b6121c19088614794565b9650876121cd816147a7565b985050600101612175565b5050600190930192506120de915050565b506040516000907f575ff3acadd5ab348fe1855e217e0f3678f8d767d7494c9f9fefbee2e17cca4d908290a261221f8682612e09565b50505050506111786001600255565b600061223a823461313e565b90508173ffffffffffffffffffffffffffffffffffffffff167f2da466a7b24304f47e87fa2e1e5a81b9831ce54fec19055ce277ca2f39ba42c48260405161178591815260200190565b6000806000845160208601878987f195945050505050565b60603d828111156122aa5750815b604051602082018101604052818152816000602083013e9392505050565b6000805a8551909150600090816122de8261317e565b60e083015190915073ffffffffffffffffffffffffffffffffffffffff811661230a5782519350612405565b80935060008851111561240557868202955060028a600281111561233057612330614ca4565b146124055760a08301516040517f7c627b2100000000000000000000000000000000000000000000000000000000815273ffffffffffffffffffffffffffffffffffffffff831691637c627b2191612392908e908d908c908990600401614cd3565b600060405180830381600088803b1580156123ac57600080fd5b5087f1935050505080156123be575060015b6124055760006123cf61080061229c565b9050806040517fad7954bc0000000000000000000000000000000000000000000000000000000081526004016107579190614d36565b5a60a0840151606085015160808c015192880399909901980190880380821115612438576064600a828403020498909801975b5050818702955085896040015110156124b5578a6040517f220266b600000000000000000000000000000000000000000000000000000000815260040161075791815260406020808301829052908201527f414135312070726566756e642062656c6f772061637475616c476173436f7374606082015260800190565b60408901518690036124c7858261313e565b506000808c60028111156124dd576124dd614ca4565b1490508460e0015173ffffffffffffffffffffffffffffffffffffffff16856000015173ffffffffffffffffffffffffffffffffffffffff168c602001517f49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f8860200151858d8f60405161256a949392919093845291151560208401526040830152606082015260800190565b60405180910390a45050505050505095945050505050565b600061258d826131a8565b805190602001209050919050565b60028054036125d6576040517f3ee5aeb500000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b60028055565b60008060005a84519091506125f1868261326d565b6125fa86610fbe565b602086015261012081015161010082015160a083015160808401516060850151604086015160c08701511717171717176effffffffffffffffffffffffffffff8111156126a3576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601860248201527f41413934206761732076616c756573206f766572666c6f7700000000000000006044820152606401610757565b60006126d28360c081015160a08201516080830151606084015160408501516101009095015194010101010290565b90506126e0898989846133b8565b95506126f4836000015184602001516135fb565b61276357886040517f220266b6000000000000000000000000000000000000000000000000000000008152600401610757918152604060208201819052601a908201527f4141323520696e76616c6964206163636f756e74206e6f6e6365000000000000606082015260800190565b60e083015160609073ffffffffffffffffffffffffffffffffffffffff1615612797576127928a8a8a85613656565b965090505b60005a86039050808560800151866040015101101561281b578a6040517f220266b6000000000000000000000000000000000000000000000000000000008152600401610757918152604060208201819052601e908201527f41413430206f76657220766572696669636174696f6e4761734c696d69740000606082015260800190565b604089018390528160608a015260a08a01355a870301896080018181525050505050505050935093915050565b60008061285485613817565b915091508173ffffffffffffffffffffffffffffffffffffffff168373ffffffffffffffffffffffffffffffffffffffff16146128f657856040517f220266b60000000000000000000000000000000000000000000000000000000081526004016107579181526040602082018190526014908201527f41413234207369676e6174757265206572726f72000000000000000000000000606082015260800190565b801561296757856040517f220266b60000000000000000000000000000000000000000000000000000000081526004016107579181526040602082018190526017908201527f414132322065787069726564206f72206e6f7420647565000000000000000000606082015260800190565b600061297285613817565b9250905073ffffffffffffffffffffffffffffffffffffffff8116156129fd57866040517f220266b60000000000000000000000000000000000000000000000000000000081526004016107579181526040602082018190526014908201527f41413334207369676e6174757265206572726f72000000000000000000000000606082015260800190565b8115612a9457866040517f220266b60000000000000000000000000000000000000000000000000000000081526004016107579181526040602082018190526021908201527f41413332207061796d61737465722065787069726564206f72206e6f7420647560608201527f6500000000000000000000000000000000000000000000000000000000000000608082015260a00190565b50505050505050565b6000805a90506000612ab0846060015190565b6040519091506000903682612ac860608a018a61499c565b9150915060606000826003811115612adf57843591505b507f72288ed1000000000000000000000000000000000000000000000000000000007fffffffff00000000000000000000000000000000000000000000000000000000821601612c1f5760008b8b60200151604051602401612b42929190614d49565b604080517fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe08184030181529181526020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff167f8dd7712f000000000000000000000000000000000000000000000000000000001790525190915030906242dc5390612bd59084908f908d90602401614e2f565b604051602081830303815290604052915060e01b6020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff8381831617835250505050925050612c96565b3073ffffffffffffffffffffffffffffffffffffffff166242dc5385858d8b604051602401612c519493929190614e6f565b604051602081830303815290604052915060e01b6020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff838183161783525050505091505b602060008351602085016000305af19550600051985084604052505050505080612dff5760003d80602003612cd15760206000803e60005191505b507fdeaddead000000000000000000000000000000000000000000000000000000008103612d6457876040517f220266b6000000000000000000000000000000000000000000000000000000008152600401610757918152604060208201819052600f908201527f41413935206f7574206f66206761730000000000000000000000000000000000606082015260800190565b8551805160208089015192015173ffffffffffffffffffffffffffffffffffffffff90911691907ff62676f440ff169a3a9afdbf812e89e7f95975ee8e5c31214ffdef631c5f479290612db861080061229c565b604051612dc692919061474c565b60405180910390a3600086608001515a612de090876147df565b612dea9190614794565b9050612dfa8960028987856122c8565b955050505b5050509392505050565b73ffffffffffffffffffffffffffffffffffffffff8216612e86576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601860248201527f4141393020696e76616c69642062656e656669636961727900000000000000006044820152606401610757565b60008273ffffffffffffffffffffffffffffffffffffffff168260405160006040518083038185875af1925050503d8060008114612ee0576040519150601f19603f3d011682016040523d82523d6000602084013e612ee5565b606091505b5050905080611178576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601f60248201527f41413931206661696c65642073656e6420746f2062656e6566696369617279006044820152606401610757565b6130506040517fd69400000000000000000000000000000000000000000000000000000000000060208201527fffffffffffffffffffffffffffffffffffffffff0000000000000000000000003060601b1660228201527f01000000000000000000000000000000000000000000000000000000000000006036820152600090603701604080518083037fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe00181529190528051602090910120600680547fffffffffffffffffffffffff00000000000000000000000000000000000000001673ffffffffffffffffffffffffffffffffffffffff90921691909117905550565b3063957122ab613063604084018461499c565b6130706020860186614349565b61307d60e087018761499c565b6040518663ffffffff1660e01b815260040161309d959493929190614ea6565b60006040518083038186803b1580156130b557600080fd5b505afa9250505080156130c6575060015b61313b576130d2614ef5565b806308c379a00361312f57506130e6614f11565b806130f15750613131565b8051156106e8576000816040517f220266b600000000000000000000000000000000000000000000000000000000815260040161075792919061474c565b505b3d6000803e3d6000fd5b50565b73ffffffffffffffffffffffffffffffffffffffff8216600090815260208190526040812080548290613172908590614794565b91829055509392505050565b6101008101516101208201516000919080820361319c575092915050565b6108b18248830161386a565b60608135602083013560006131c86131c3604087018761499c565b613882565b905060006131dc6131c3606088018861499c565b9050608086013560a087013560c088013560006131ff6131c360e08c018c61499c565b6040805173ffffffffffffffffffffffffffffffffffffffff9a909a1660208b015289810198909852606089019690965250608087019390935260a086019190915260c085015260e08401526101008084019190915281518084039091018152610120909201905292915050565b61327a6020830183614349565b73ffffffffffffffffffffffffffffffffffffffff168152602082810135908201526fffffffffffffffffffffffffffffffff6080808401358281166060850152811c604084015260a084013560c0808501919091528401359182166101008401521c6101208201523660006132f360e085018561499c565b9092509050801561339d576034811015613369576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601d60248201527f4141393320696e76616c6964207061796d6173746572416e64446174610000006044820152606401610757565b6133738282613895565b60a0860152608085015273ffffffffffffffffffffffffffffffffffffffff1660e0840152610fb8565b600060e084018190526080840181905260a084015250505050565b81518051600091906133d787866133d260408a018a61499c565b613906565b60e0820151600073ffffffffffffffffffffffffffffffffffffffff82166134355773ffffffffffffffffffffffffffffffffffffffff831660009081526020819052604090205486811161342e57808703613431565b60005b9150505b604080850151602089015191517f19822f7c00000000000000000000000000000000000000000000000000000000815273ffffffffffffffffffffffffffffffffffffffff8616926319822f7c9291613494918d918790600401614fb9565b60206040518083038160008887f1935050505080156134ee575060408051601f3d9081017fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe01682019092526134eb91810190614fde565b60015b61353257886134fe61080061229c565b6040517f65c8fd4d000000000000000000000000000000000000000000000000000000008152600401610757929190614ff7565b945073ffffffffffffffffffffffffffffffffffffffff82166135ef5773ffffffffffffffffffffffffffffffffffffffff831660009081526020819052604090208054808811156135e9578a6040517f220266b60000000000000000000000000000000000000000000000000000000081526004016107579181526040602082018190526017908201527f41413231206469646e2774207061792070726566756e64000000000000000000606082015260800190565b87900390555b50505050949350505050565b73ffffffffffffffffffffffffffffffffffffffff8216600090815260016020908152604080832084821c808552925282208054849167ffffffffffffffff8316919085613648836147a7565b909155501495945050505050565b815160e081015173ffffffffffffffffffffffffffffffffffffffff81166000908152602081905260408120805460609492939190868110156136fe57896040517f220266b6000000000000000000000000000000000000000000000000000000008152600401610757918152604060208201819052601e908201527f41413331207061796d6173746572206465706f73697420746f6f206c6f770000606082015260800190565b8681038255608084015160208901516040517f52b7512c00000000000000000000000000000000000000000000000000000000815273ffffffffffffffffffffffffffffffffffffffff8616926352b7512c929091613763918e918d90600401614fb9565b60006040518083038160008887f1935050505080156137c257506040513d6000823e601f3d9081017fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe01682016040526137bf9190810190615044565b60015b61380657896137d261080061229c565b6040517f65c8fd4d0000000000000000000000000000000000000000000000000000000081526004016107579291906150d0565b909b909a5098505050505050505050565b6000808260000361382d57506000928392509050565b600061383884613c92565b9050806040015165ffffffffffff1642118061385f5750806020015165ffffffffffff1642105b905194909350915050565b6000818310613879578161387b565b825b9392505050565b6000604051828085833790209392505050565b600080806138a6601482868861488a565b6138af916148b4565b60601c6138c060246014878961488a565b6138c99161511d565b60801c6138da60346024888a61488a565b6138e39161511d565b9194506fffffffffffffffffffffffffffffffff16925060801c90509250925092565b8015610fb85782515173ffffffffffffffffffffffffffffffffffffffff81163b1561399757846040517f220266b6000000000000000000000000000000000000000000000000000000008152600401610757918152604060208201819052601f908201527f414131302073656e64657220616c726561647920636f6e737472756374656400606082015260800190565b60006139b860065473ffffffffffffffffffffffffffffffffffffffff1690565b73ffffffffffffffffffffffffffffffffffffffff1663570e1a3686600001516040015186866040518463ffffffff1660e01b81526004016139fb929190614945565b60206040518083038160008887f1158015613a1a573d6000803e3d6000fd5b50505050506040513d601f19601f82011682018060405250810190613a3f9190614959565b905073ffffffffffffffffffffffffffffffffffffffff8116613ac757856040517f220266b6000000000000000000000000000000000000000000000000000000008152600401610757918152604060208201819052601b908201527f4141313320696e6974436f6465206661696c6564206f72204f4f470000000000606082015260800190565b8173ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614613b6457856040517f220266b600000000000000000000000000000000000000000000000000000000815260040161075791815260406020808301829052908201527f4141313420696e6974436f6465206d7573742072657475726e2073656e646572606082015260800190565b8073ffffffffffffffffffffffffffffffffffffffff163b600003613bed57856040517f220266b600000000000000000000000000000000000000000000000000000000815260040161075791815260406020808301829052908201527f4141313520696e6974436f6465206d757374206372656174652073656e646572606082015260800190565b6000613bfc601482868861488a565b613c05916148b4565b60601c90508273ffffffffffffffffffffffffffffffffffffffff1686602001517fd51a9c61267aa6196961883ecf5ff2da6619c37dac0fa92122513fb32c032d2d83896000015160e00151604051613c8192919073ffffffffffffffffffffffffffffffffffffffff92831681529116602082015260400190565b60405180910390a350505050505050565b60408051606081018252600080825260208201819052918101919091528160a081901c65ffffffffffff8116600003613cce575065ffffffffffff5b6040805160608101825273ffffffffffffffffffffffffffffffffffffffff909316835260d09490941c602083015265ffffffffffff16928101929092525090565b6040518060a00160405280613d9d604051806101400160405280600073ffffffffffffffffffffffffffffffffffffffff168152602001600081526020016000815260200160008152602001600081526020016000815260200160008152602001600073ffffffffffffffffffffffffffffffffffffffff16815260200160008152602001600081525090565b8152602001600080191681526020016000815260200160008152602001600081525090565b6040518060a00160405280613dff6040518060a0016040528060008152602001600081526020016000815260200160008152602001606081525090565b8152602001613e21604051806040016040528060008152602001600081525090565b8152602001613e43604051806040016040528060008152602001600081525090565b8152602001613e65604051806040016040528060008152602001600081525090565b8152602001613e72613e77565b905290565b6040518060400160405280600073ffffffffffffffffffffffffffffffffffffffff168152602001613e72604051806040016040528060008152602001600081525090565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b60a0810181811067ffffffffffffffff82111715613f0b57613f0b613ebc565b60405250565b7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0601f830116810181811067ffffffffffffffff82111715613f5557613f55613ebc565b6040525050565b604051610140810167ffffffffffffffff81118282101715613f8057613f80613ebc565b60405290565b600067ffffffffffffffff821115613fa057613fa0613ebc565b50601f017fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe01660200190565b73ffffffffffffffffffffffffffffffffffffffff8116811461313b57600080fd5b8035613ff981613fcc565b919050565b60008183036101c081121561401257600080fd5b60405161401e81613eeb565b8092506101408083121561403157600080fd5b614039613f5c565b925061404485613fee565b83526020850135602084015260408501356040840152606085013560608401526080850135608084015260a085013560a084015260c085013560c084015261408e60e08601613fee565b60e084015261010085810135908401526101208086013590840152918152908301356020820152610160830135604082015261018083013560608201526101a090920135608090920191909152919050565b60008083601f8401126140f257600080fd5b50813567ffffffffffffffff81111561410a57600080fd5b60208301915083602082850101111561412257600080fd5b9250929050565b600080600080610200858703121561414057600080fd5b843567ffffffffffffffff8082111561415857600080fd5b818701915087601f83011261416c57600080fd5b813561417781613f86565b6040516141848282613f11565b8281528a602084870101111561419957600080fd5b826020860160208301376000602084830101528098505050506141bf8860208901613ffe565b94506101e08701359150808211156141d657600080fd5b506141e3878288016140e0565b95989497509550505050565b60006020828403121561420157600080fd5b81357fffffffff000000000000000000000000000000000000000000000000000000008116811461387b57600080fd5b60006020828403121561424357600080fd5b813563ffffffff8116811461387b57600080fd5b803577ffffffffffffffffffffffffffffffffffffffffffffffff81168114613ff957600080fd5b60006020828403121561429157600080fd5b61387b82614257565b600080604083850312156142ad57600080fd5b82356142b881613fcc565b91506142c660208401614257565b90509250929050565b600080604083850312156142e257600080fd5b82356142ed81613fcc565b946020939093013593505050565b6000610120828403121561430e57600080fd5b50919050565b60006020828403121561432657600080fd5b813567ffffffffffffffff81111561433d57600080fd5b6108b1848285016142fb565b60006020828403121561435b57600080fd5b813561387b81613fcc565b60008083601f84011261437857600080fd5b50813567ffffffffffffffff81111561439057600080fd5b6020830191508360208260051b850101111561412257600080fd5b6000806000604084860312156143c057600080fd5b833567ffffffffffffffff8111156143d757600080fd5b6143e386828701614366565b90945092505060208401356143f781613fcc565b809150509250925092565b60008060006040848603121561441757600080fd5b833561442281613fcc565b9250602084013567ffffffffffffffff81111561443e57600080fd5b61444a868287016140e0565b9497909650939450505050565b60008060008060006060868803121561446f57600080fd5b853567ffffffffffffffff8082111561448757600080fd5b61449389838a016140e0565b9097509550602088013591506144a882613fcc565b909350604087013590808211156144be57600080fd5b506144cb888289016140e0565b969995985093965092949392505050565b600080600080606085870312156144f257600080fd5b843567ffffffffffffffff8082111561450a57600080fd5b614516888389016142fb565b95506020870135915061452882613fcc565b909350604086013590808211156141d657600080fd5b60005b83811015614559578181015183820152602001614541565b50506000910152565b6000815180845261457a81602086016020860161453e565b601f017fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0169290920160200192915050565b60208152815160208201526020820151604082015260408201516060820152606082015160808201526080820151151560a0820152600060a083015160c0808401526108b160e0840182614562565b6000806020838503121561460e57600080fd5b823567ffffffffffffffff81111561462557600080fd5b614631858286016140e0565b90969095509350505050565b602080825282516101408383015280516101608401529081015161018083015260408101516101a083015260608101516101c08301526080015160a06101e0830152600090614690610200840182614562565b905060208401516146ae604085018280518252602090810151910152565b506040840151805160808581019190915260209182015160a08601526060860151805160c087015282015160e0860152850151805173ffffffffffffffffffffffffffffffffffffffff1661010086015280820151805161012087015290910151610140850152509392505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601260045260246000fd5b8281526040602082015260006108b16040830184614562565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b80820180821115610a3057610a30614765565b60007fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff82036147d8576147d8614765565b5060010190565b81810381811115610a3057610a30614765565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052603260045260246000fd5b600082357ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffee183360301811261485557600080fd5b9190910192915050565b8183823760009101908152919050565b82151581526040602082015260006108b16040830184614562565b6000808585111561489a57600080fd5b838611156148a757600080fd5b5050820193919092039150565b7fffffffffffffffffffffffffffffffffffffffff00000000000000000000000081358181169160148510156148f45780818660140360031b1b83161692505b505092915050565b8183528181602085013750600060208284010152600060207fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0601f840116840101905092915050565b6020815260006108b16020830184866148fc565b60006020828403121561496b57600080fd5b815161387b81613fcc565b65ffffffffffff81811683821601908082111561499557614995614765565b5092915050565b60008083357fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe18436030181126149d157600080fd5b83018035915067ffffffffffffffff8211156149ec57600080fd5b60200191503681900382131561412257600080fd5b600082357fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa183360301811261485557600080fd5b60008083357fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe1843603018112614a6a57600080fd5b83018035915067ffffffffffffffff821115614a8557600080fd5b6020019150600581901b360382131561412257600080fd5b60008083357fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe1843603018112614ad257600080fd5b830160208101925035905067ffffffffffffffff811115614af257600080fd5b80360382131561412257600080fd5b6000610120614b2d84614b1385613fee565b73ffffffffffffffffffffffffffffffffffffffff169052565b60208301356020850152614b446040840184614a9d565b826040870152614b5783870182846148fc565b92505050614b686060840184614a9d565b8583036060870152614b7b8382846148fc565b925050506080830135608085015260a083013560a085015260c083013560c0850152614baa60e0840184614a9d565b85830360e0870152614bbd8382846148fc565b92505050610100614bd081850185614a9d565b86840383880152614be28482846148fc565b979650505050505050565b6040808252810184905260006060600586901b830181019083018783805b89811015614c8d577fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa087860301845282357ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffee18c3603018112614c6b578283fd5b614c77868d8301614b01565b9550506020938401939290920191600101614c0b565b505050508281036020840152614be28185876148fc565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602160045260246000fd5b600060038610614d0c577f4e487b7100000000000000000000000000000000000000000000000000000000600052602160045260246000fd5b85825260806020830152614d236080830186614562565b6040830194909452506060015292915050565b60208152600061387b6020830184614562565b604081526000614d5c6040830185614b01565b90508260208301529392505050565b8051805173ffffffffffffffffffffffffffffffffffffffff1683526020810151602084015260408101516040840152606081015160608401526080810151608084015260a081015160a084015260c081015160c084015260e0810151614dea60e085018273ffffffffffffffffffffffffffffffffffffffff169052565b5061010081810151908401526101209081015190830152602081015161014083015260408101516101608301526060810151610180830152608001516101a090910152565b6000610200808352614e4381840187614562565b9050614e526020840186614d6b565b8281036101e0840152614e658185614562565b9695505050505050565b6000610200808352614e8481840187896148fc565b9050614e936020840186614d6b565b8281036101e0840152614be28185614562565b606081526000614eba6060830187896148fc565b73ffffffffffffffffffffffffffffffffffffffff861660208401528281036040840152614ee98185876148fc565b98975050505050505050565b600060033d1115614f0e5760046000803e5060005160e01c5b90565b600060443d1015614f1f5790565b6040517ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc803d016004833e81513d67ffffffffffffffff8160248401118184111715614f6d57505050505090565b8285019150815181811115614f855750505050505090565b843d8701016020828501011115614f9f5750505050505090565b614fae60208286010187613f11565b509095945050505050565b606081526000614fcc6060830186614b01565b60208301949094525060400152919050565b600060208284031215614ff057600080fd5b5051919050565b82815260606020820152600d60608201527f4141323320726576657274656400000000000000000000000000000000000000608082015260a0604082015260006108b160a0830184614562565b6000806040838503121561505757600080fd5b825167ffffffffffffffff81111561506e57600080fd5b8301601f8101851361507f57600080fd5b805161508a81613f86565b6040516150978282613f11565b8281528760208486010111156150ac57600080fd5b6150bd83602083016020870161453e565b6020969096015195979596505050505050565b82815260606020820152600d60608201527f4141333320726576657274656400000000000000000000000000000000000000608082015260a0604082015260006108b160a0830184614562565b7fffffffffffffffffffffffffffffffff0000000000000000000000000000000081358181169160108510156148f45760109490940360031b84901b169092169291505056fea2646970667358221220025c409d068df3e4bce6966c5e933656efa16b8ca4d71f5585486e9aa37584aa64736f6c63430008170033608060405234801561001057600080fd5b50610213806100206000396000f3fe608060405234801561001057600080fd5b506004361061002b5760003560e01c8063570e1a3614610030575b600080fd5b61004361003e3660046100f9565b61006c565b60405173ffffffffffffffffffffffffffffffffffffffff909116815260200160405180910390f35b60008061007c601482858761016b565b61008591610195565b60601c90506000610099846014818861016b565b8080601f016020809104026020016040519081016040528093929190818152602001838380828437600092018290525084519495509360209350849250905082850182875af190506000519350806100f057600093505b50505092915050565b6000806020838503121561010c57600080fd5b823567ffffffffffffffff8082111561012457600080fd5b818501915085601f83011261013857600080fd5b81358181111561014757600080fd5b86602082850101111561015957600080fd5b60209290920196919550909350505050565b6000808585111561017b57600080fd5b8386111561018857600080fd5b5050820193919092039150565b7fffffffffffffffffffffffffffffffffffffffff00000000000000000000000081358181169160148510156101d55780818660140360031b1b83161692505b50509291505056fea2646970667358221220f4eeea3c52e568afe7af0cb6d22e9eba322f25189228e2d96485c8f1d485112464736f6c63430008170033"
