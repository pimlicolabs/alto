import type { Hex } from "viem"

export const EntryPointV07SimulationsAbi = [
    { type: "constructor", inputs: [], stateMutability: "nonpayable" },
    { type: "receive", stateMutability: "payable" },
    {
        type: "function",
        name: "_accountValidation",
        inputs: [
            { name: "opIndex", type: "uint256", internalType: "uint256" },
            {
                name: "userOp",
                type: "tuple",
                internalType: "struct PackedUserOperation",
                components: [
                    {
                        name: "sender",
                        type: "address",
                        internalType: "address"
                    },
                    { name: "nonce", type: "uint256", internalType: "uint256" },
                    { name: "initCode", type: "bytes", internalType: "bytes" },
                    { name: "callData", type: "bytes", internalType: "bytes" },
                    {
                        name: "accountGasLimits",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "preVerificationGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "gasFees",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "paymasterAndData",
                        type: "bytes",
                        internalType: "bytes"
                    },
                    { name: "signature", type: "bytes", internalType: "bytes" }
                ]
            },
            {
                name: "outOpInfo",
                type: "tuple",
                internalType: "struct EntryPoint.UserOpInfo",
                components: [
                    {
                        name: "mUserOp",
                        type: "tuple",
                        internalType: "struct EntryPoint.MemoryUserOp",
                        components: [
                            {
                                name: "sender",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "nonce",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "verificationGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "callGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterVerificationGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterPostOpGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "preVerificationGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymaster",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "maxFeePerGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "maxPriorityFeePerGas",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "userOpHash",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "prefund",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "contextOffset",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "preOpGas",
                        type: "uint256",
                        internalType: "uint256"
                    }
                ]
            }
        ],
        outputs: [
            {
                name: "validationData",
                type: "uint256",
                internalType: "uint256"
            },
            {
                name: "paymasterValidationData",
                type: "uint256",
                internalType: "uint256"
            },
            {
                name: "paymasterVerificationGasLimit",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "_paymasterValidation",
        inputs: [
            { name: "opIndex", type: "uint256", internalType: "uint256" },
            {
                name: "userOp",
                type: "tuple",
                internalType: "struct PackedUserOperation",
                components: [
                    {
                        name: "sender",
                        type: "address",
                        internalType: "address"
                    },
                    { name: "nonce", type: "uint256", internalType: "uint256" },
                    { name: "initCode", type: "bytes", internalType: "bytes" },
                    { name: "callData", type: "bytes", internalType: "bytes" },
                    {
                        name: "accountGasLimits",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "preVerificationGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "gasFees",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "paymasterAndData",
                        type: "bytes",
                        internalType: "bytes"
                    },
                    { name: "signature", type: "bytes", internalType: "bytes" }
                ]
            },
            {
                name: "outOpInfo",
                type: "tuple",
                internalType: "struct EntryPoint.UserOpInfo",
                components: [
                    {
                        name: "mUserOp",
                        type: "tuple",
                        internalType: "struct EntryPoint.MemoryUserOp",
                        components: [
                            {
                                name: "sender",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "nonce",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "verificationGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "callGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterVerificationGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterPostOpGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "preVerificationGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymaster",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "maxFeePerGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "maxPriorityFeePerGas",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "userOpHash",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "prefund",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "contextOffset",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "preOpGas",
                        type: "uint256",
                        internalType: "uint256"
                    }
                ]
            }
        ],
        outputs: [
            {
                name: "validationData",
                type: "uint256",
                internalType: "uint256"
            },
            {
                name: "paymasterValidationData",
                type: "uint256",
                internalType: "uint256"
            },
            {
                name: "paymasterVerificationGasLimit",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "_validatePrepayment",
        inputs: [
            { name: "opIndex", type: "uint256", internalType: "uint256" },
            {
                name: "userOp",
                type: "tuple",
                internalType: "struct PackedUserOperation",
                components: [
                    {
                        name: "sender",
                        type: "address",
                        internalType: "address"
                    },
                    { name: "nonce", type: "uint256", internalType: "uint256" },
                    { name: "initCode", type: "bytes", internalType: "bytes" },
                    { name: "callData", type: "bytes", internalType: "bytes" },
                    {
                        name: "accountGasLimits",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "preVerificationGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "gasFees",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "paymasterAndData",
                        type: "bytes",
                        internalType: "bytes"
                    },
                    { name: "signature", type: "bytes", internalType: "bytes" }
                ]
            },
            {
                name: "outOpInfo",
                type: "tuple",
                internalType: "struct EntryPoint.UserOpInfo",
                components: [
                    {
                        name: "mUserOp",
                        type: "tuple",
                        internalType: "struct EntryPoint.MemoryUserOp",
                        components: [
                            {
                                name: "sender",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "nonce",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "verificationGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "callGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterVerificationGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterPostOpGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "preVerificationGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymaster",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "maxFeePerGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "maxPriorityFeePerGas",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "userOpHash",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "prefund",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "contextOffset",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "preOpGas",
                        type: "uint256",
                        internalType: "uint256"
                    }
                ]
            }
        ],
        outputs: [
            {
                name: "validationData",
                type: "uint256",
                internalType: "uint256"
            },
            {
                name: "paymasterValidationData",
                type: "uint256",
                internalType: "uint256"
            },
            {
                name: "paymasterVerificationGasLimit",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "addStake",
        inputs: [
            { name: "unstakeDelaySec", type: "uint32", internalType: "uint32" }
        ],
        outputs: [],
        stateMutability: "payable"
    },
    {
        type: "function",
        name: "balanceOf",
        inputs: [{ name: "account", type: "address", internalType: "address" }],
        outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "binarySearchGasLimit",
        inputs: [
            {
                name: "queuedUserOps",
                type: "tuple[]",
                internalType: "struct SimulationArgs[]",
                components: [
                    {
                        name: "op",
                        type: "tuple",
                        internalType: "struct PackedUserOperation",
                        components: [
                            {
                                name: "sender",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "nonce",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "initCode",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "callData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "accountGasLimits",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "preVerificationGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "gasFees",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "paymasterAndData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "signature",
                                type: "bytes",
                                internalType: "bytes"
                            }
                        ]
                    },
                    {
                        name: "target",
                        type: "address",
                        internalType: "address"
                    },
                    {
                        name: "targetCallData",
                        type: "bytes",
                        internalType: "bytes"
                    }
                ]
            },
            {
                name: "targetUserOp",
                type: "tuple",
                internalType: "struct SimulationArgs",
                components: [
                    {
                        name: "op",
                        type: "tuple",
                        internalType: "struct PackedUserOperation",
                        components: [
                            {
                                name: "sender",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "nonce",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "initCode",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "callData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "accountGasLimits",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "preVerificationGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "gasFees",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "paymasterAndData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "signature",
                                type: "bytes",
                                internalType: "bytes"
                            }
                        ]
                    },
                    {
                        name: "target",
                        type: "address",
                        internalType: "address"
                    },
                    {
                        name: "targetCallData",
                        type: "bytes",
                        internalType: "bytes"
                    }
                ]
            },
            { name: "entryPoint", type: "address", internalType: "address" },
            { name: "initialMinGas", type: "uint256", internalType: "uint256" },
            {
                name: "toleranceDelta",
                type: "uint256",
                internalType: "uint256"
            },
            { name: "gasAllowance", type: "uint256", internalType: "uint256" },
            { name: "payload", type: "bytes", internalType: "bytes" }
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                internalType: "struct IEntryPointSimulations.TargetCallResult",
                components: [
                    {
                        name: "gasUsed",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    { name: "success", type: "bool", internalType: "bool" },
                    { name: "returnData", type: "bytes", internalType: "bytes" }
                ]
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "binarySearchPaymasterVerificationGasLimit",
        inputs: [
            {
                name: "queuedUserOps",
                type: "tuple[]",
                internalType: "struct SimulationArgs[]",
                components: [
                    {
                        name: "op",
                        type: "tuple",
                        internalType: "struct PackedUserOperation",
                        components: [
                            {
                                name: "sender",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "nonce",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "initCode",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "callData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "accountGasLimits",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "preVerificationGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "gasFees",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "paymasterAndData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "signature",
                                type: "bytes",
                                internalType: "bytes"
                            }
                        ]
                    },
                    {
                        name: "target",
                        type: "address",
                        internalType: "address"
                    },
                    {
                        name: "targetCallData",
                        type: "bytes",
                        internalType: "bytes"
                    }
                ]
            },
            {
                name: "targetUserOp",
                type: "tuple",
                internalType: "struct SimulationArgs",
                components: [
                    {
                        name: "op",
                        type: "tuple",
                        internalType: "struct PackedUserOperation",
                        components: [
                            {
                                name: "sender",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "nonce",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "initCode",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "callData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "accountGasLimits",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "preVerificationGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "gasFees",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "paymasterAndData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "signature",
                                type: "bytes",
                                internalType: "bytes"
                            }
                        ]
                    },
                    {
                        name: "target",
                        type: "address",
                        internalType: "address"
                    },
                    {
                        name: "targetCallData",
                        type: "bytes",
                        internalType: "bytes"
                    }
                ]
            },
            { name: "entryPoint", type: "address", internalType: "address" },
            { name: "initialMinGas", type: "uint256", internalType: "uint256" },
            {
                name: "toleranceDelta",
                type: "uint256",
                internalType: "uint256"
            },
            { name: "gasAllowance", type: "uint256", internalType: "uint256" }
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                internalType: "struct IEntryPointSimulations.TargetCallResult",
                components: [
                    {
                        name: "gasUsed",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    { name: "success", type: "bool", internalType: "bool" },
                    { name: "returnData", type: "bytes", internalType: "bytes" }
                ]
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "binarySearchVerificationGasLimit",
        inputs: [
            {
                name: "queuedUserOps",
                type: "tuple[]",
                internalType: "struct SimulationArgs[]",
                components: [
                    {
                        name: "op",
                        type: "tuple",
                        internalType: "struct PackedUserOperation",
                        components: [
                            {
                                name: "sender",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "nonce",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "initCode",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "callData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "accountGasLimits",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "preVerificationGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "gasFees",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "paymasterAndData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "signature",
                                type: "bytes",
                                internalType: "bytes"
                            }
                        ]
                    },
                    {
                        name: "target",
                        type: "address",
                        internalType: "address"
                    },
                    {
                        name: "targetCallData",
                        type: "bytes",
                        internalType: "bytes"
                    }
                ]
            },
            {
                name: "targetUserOp",
                type: "tuple",
                internalType: "struct SimulationArgs",
                components: [
                    {
                        name: "op",
                        type: "tuple",
                        internalType: "struct PackedUserOperation",
                        components: [
                            {
                                name: "sender",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "nonce",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "initCode",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "callData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "accountGasLimits",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "preVerificationGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "gasFees",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "paymasterAndData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "signature",
                                type: "bytes",
                                internalType: "bytes"
                            }
                        ]
                    },
                    {
                        name: "target",
                        type: "address",
                        internalType: "address"
                    },
                    {
                        name: "targetCallData",
                        type: "bytes",
                        internalType: "bytes"
                    }
                ]
            },
            { name: "entryPoint", type: "address", internalType: "address" },
            { name: "initialMinGas", type: "uint256", internalType: "uint256" },
            {
                name: "toleranceDelta",
                type: "uint256",
                internalType: "uint256"
            },
            { name: "gasAllowance", type: "uint256", internalType: "uint256" }
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                internalType: "struct IEntryPointSimulations.TargetCallResult",
                components: [
                    {
                        name: "gasUsed",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    { name: "success", type: "bool", internalType: "bool" },
                    { name: "returnData", type: "bytes", internalType: "bytes" }
                ]
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "depositTo",
        inputs: [{ name: "account", type: "address", internalType: "address" }],
        outputs: [],
        stateMutability: "payable"
    },
    {
        type: "function",
        name: "deposits",
        inputs: [{ name: "", type: "address", internalType: "address" }],
        outputs: [
            { name: "deposit", type: "uint256", internalType: "uint256" },
            { name: "staked", type: "bool", internalType: "bool" },
            { name: "stake", type: "uint112", internalType: "uint112" },
            { name: "unstakeDelaySec", type: "uint32", internalType: "uint32" },
            { name: "withdrawTime", type: "uint48", internalType: "uint48" }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "getDepositInfo",
        inputs: [{ name: "account", type: "address", internalType: "address" }],
        outputs: [
            {
                name: "info",
                type: "tuple",
                internalType: "struct IStakeManager.DepositInfo",
                components: [
                    {
                        name: "deposit",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    { name: "staked", type: "bool", internalType: "bool" },
                    { name: "stake", type: "uint112", internalType: "uint112" },
                    {
                        name: "unstakeDelaySec",
                        type: "uint32",
                        internalType: "uint32"
                    },
                    {
                        name: "withdrawTime",
                        type: "uint48",
                        internalType: "uint48"
                    }
                ]
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "getNonce",
        inputs: [
            { name: "sender", type: "address", internalType: "address" },
            { name: "key", type: "uint192", internalType: "uint192" }
        ],
        outputs: [{ name: "nonce", type: "uint256", internalType: "uint256" }],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "getUserOpHash",
        inputs: [
            {
                name: "userOp",
                type: "tuple",
                internalType: "struct PackedUserOperation",
                components: [
                    {
                        name: "sender",
                        type: "address",
                        internalType: "address"
                    },
                    { name: "nonce", type: "uint256", internalType: "uint256" },
                    { name: "initCode", type: "bytes", internalType: "bytes" },
                    { name: "callData", type: "bytes", internalType: "bytes" },
                    {
                        name: "accountGasLimits",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "preVerificationGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "gasFees",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "paymasterAndData",
                        type: "bytes",
                        internalType: "bytes"
                    },
                    { name: "signature", type: "bytes", internalType: "bytes" }
                ]
            }
        ],
        outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "incrementNonce",
        inputs: [{ name: "key", type: "uint192", internalType: "uint192" }],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "innerHandleOp",
        inputs: [
            { name: "callData", type: "bytes", internalType: "bytes" },
            {
                name: "opInfo",
                type: "tuple",
                internalType: "struct EntryPoint.UserOpInfo",
                components: [
                    {
                        name: "mUserOp",
                        type: "tuple",
                        internalType: "struct EntryPoint.MemoryUserOp",
                        components: [
                            {
                                name: "sender",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "nonce",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "verificationGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "callGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterVerificationGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterPostOpGasLimit",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "preVerificationGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymaster",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "maxFeePerGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "maxPriorityFeePerGas",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "userOpHash",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "prefund",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "contextOffset",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "preOpGas",
                        type: "uint256",
                        internalType: "uint256"
                    }
                ]
            },
            { name: "context", type: "bytes", internalType: "bytes" },
            { name: "preGas", type: "uint256", internalType: "uint256" }
        ],
        outputs: [
            { name: "actualGasCost", type: "uint256", internalType: "uint256" },
            {
                name: "paymasterPostOpGasLimit",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "nonceSequenceNumber",
        inputs: [
            { name: "", type: "address", internalType: "address" },
            { name: "", type: "uint192", internalType: "uint192" }
        ],
        outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "simulateCall",
        inputs: [
            { name: "entryPoint", type: "address", internalType: "address" },
            { name: "payload", type: "bytes", internalType: "bytes" },
            { name: "gas", type: "uint256", internalType: "uint256" }
        ],
        outputs: [
            { name: "success", type: "bool", internalType: "bool" },
            { name: "result", type: "bytes", internalType: "bytes" }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "simulateCallAndRevert",
        inputs: [
            { name: "target", type: "address", internalType: "address" },
            { name: "data", type: "bytes", internalType: "bytes" },
            { name: "gas", type: "uint256", internalType: "uint256" }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "simulateCallData",
        inputs: [
            {
                name: "queuedUserOps",
                type: "tuple[]",
                internalType: "struct SimulationArgs[]",
                components: [
                    {
                        name: "op",
                        type: "tuple",
                        internalType: "struct PackedUserOperation",
                        components: [
                            {
                                name: "sender",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "nonce",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "initCode",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "callData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "accountGasLimits",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "preVerificationGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "gasFees",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "paymasterAndData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "signature",
                                type: "bytes",
                                internalType: "bytes"
                            }
                        ]
                    },
                    {
                        name: "target",
                        type: "address",
                        internalType: "address"
                    },
                    {
                        name: "targetCallData",
                        type: "bytes",
                        internalType: "bytes"
                    }
                ]
            },
            {
                name: "targetUserOp",
                type: "tuple",
                internalType: "struct SimulationArgs",
                components: [
                    {
                        name: "op",
                        type: "tuple",
                        internalType: "struct PackedUserOperation",
                        components: [
                            {
                                name: "sender",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "nonce",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "initCode",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "callData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "accountGasLimits",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "preVerificationGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "gasFees",
                                type: "bytes32",
                                internalType: "bytes32"
                            },
                            {
                                name: "paymasterAndData",
                                type: "bytes",
                                internalType: "bytes"
                            },
                            {
                                name: "signature",
                                type: "bytes",
                                internalType: "bytes"
                            }
                        ]
                    },
                    {
                        name: "target",
                        type: "address",
                        internalType: "address"
                    },
                    {
                        name: "targetCallData",
                        type: "bytes",
                        internalType: "bytes"
                    }
                ]
            },
            { name: "entryPoint", type: "address", internalType: "address" },
            { name: "initialMinGas", type: "uint256", internalType: "uint256" },
            {
                name: "toleranceDelta",
                type: "uint256",
                internalType: "uint256"
            },
            { name: "gasAllowance", type: "uint256", internalType: "uint256" }
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                internalType: "struct IEntryPointSimulations.TargetCallResult",
                components: [
                    {
                        name: "gasUsed",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    { name: "success", type: "bool", internalType: "bool" },
                    { name: "returnData", type: "bytes", internalType: "bytes" }
                ]
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "simulateHandleOp",
        inputs: [
            {
                name: "op",
                type: "tuple",
                internalType: "struct PackedUserOperation",
                components: [
                    {
                        name: "sender",
                        type: "address",
                        internalType: "address"
                    },
                    { name: "nonce", type: "uint256", internalType: "uint256" },
                    { name: "initCode", type: "bytes", internalType: "bytes" },
                    { name: "callData", type: "bytes", internalType: "bytes" },
                    {
                        name: "accountGasLimits",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "preVerificationGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "gasFees",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "paymasterAndData",
                        type: "bytes",
                        internalType: "bytes"
                    },
                    { name: "signature", type: "bytes", internalType: "bytes" }
                ]
            }
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                internalType: "struct IEntryPointSimulations.ExecutionResult",
                components: [
                    {
                        name: "preOpGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    { name: "paid", type: "uint256", internalType: "uint256" },
                    {
                        name: "accountValidationData",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "paymasterValidationData",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "paymasterVerificationGasLimit",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "paymasterPostOpGasLimit",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "targetSuccess",
                        type: "bool",
                        internalType: "bool"
                    },
                    {
                        name: "targetResult",
                        type: "bytes",
                        internalType: "bytes"
                    }
                ]
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "simulateHandleOpBulk",
        inputs: [
            {
                name: "ops",
                type: "tuple[]",
                internalType: "struct PackedUserOperation[]",
                components: [
                    {
                        name: "sender",
                        type: "address",
                        internalType: "address"
                    },
                    { name: "nonce", type: "uint256", internalType: "uint256" },
                    { name: "initCode", type: "bytes", internalType: "bytes" },
                    { name: "callData", type: "bytes", internalType: "bytes" },
                    {
                        name: "accountGasLimits",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "preVerificationGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "gasFees",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "paymasterAndData",
                        type: "bytes",
                        internalType: "bytes"
                    },
                    { name: "signature", type: "bytes", internalType: "bytes" }
                ]
            }
        ],
        outputs: [
            {
                name: "",
                type: "tuple[]",
                internalType: "struct IEntryPointSimulations.ExecutionResult[]",
                components: [
                    {
                        name: "preOpGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    { name: "paid", type: "uint256", internalType: "uint256" },
                    {
                        name: "accountValidationData",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "paymasterValidationData",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "paymasterVerificationGasLimit",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "paymasterPostOpGasLimit",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "targetSuccess",
                        type: "bool",
                        internalType: "bool"
                    },
                    {
                        name: "targetResult",
                        type: "bytes",
                        internalType: "bytes"
                    }
                ]
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "simulateHandleOpLast",
        inputs: [
            {
                name: "ops",
                type: "tuple[]",
                internalType: "struct PackedUserOperation[]",
                components: [
                    {
                        name: "sender",
                        type: "address",
                        internalType: "address"
                    },
                    { name: "nonce", type: "uint256", internalType: "uint256" },
                    { name: "initCode", type: "bytes", internalType: "bytes" },
                    { name: "callData", type: "bytes", internalType: "bytes" },
                    {
                        name: "accountGasLimits",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "preVerificationGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "gasFees",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "paymasterAndData",
                        type: "bytes",
                        internalType: "bytes"
                    },
                    { name: "signature", type: "bytes", internalType: "bytes" }
                ]
            }
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                internalType: "struct IEntryPointSimulations.ExecutionResult",
                components: [
                    {
                        name: "preOpGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    { name: "paid", type: "uint256", internalType: "uint256" },
                    {
                        name: "accountValidationData",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "paymasterValidationData",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "paymasterVerificationGasLimit",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "paymasterPostOpGasLimit",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "targetSuccess",
                        type: "bool",
                        internalType: "bool"
                    },
                    {
                        name: "targetResult",
                        type: "bytes",
                        internalType: "bytes"
                    }
                ]
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "simulateValidation",
        inputs: [
            {
                name: "userOp",
                type: "tuple",
                internalType: "struct PackedUserOperation",
                components: [
                    {
                        name: "sender",
                        type: "address",
                        internalType: "address"
                    },
                    { name: "nonce", type: "uint256", internalType: "uint256" },
                    { name: "initCode", type: "bytes", internalType: "bytes" },
                    { name: "callData", type: "bytes", internalType: "bytes" },
                    {
                        name: "accountGasLimits",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "preVerificationGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "gasFees",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "paymasterAndData",
                        type: "bytes",
                        internalType: "bytes"
                    },
                    { name: "signature", type: "bytes", internalType: "bytes" }
                ]
            }
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                internalType: "struct IEntryPointSimulations.ValidationResult",
                components: [
                    {
                        name: "returnInfo",
                        type: "tuple",
                        internalType: "struct IEntryPoint.ReturnInfo",
                        components: [
                            {
                                name: "preOpGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "prefund",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "accountValidationData",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterValidationData",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterContext",
                                type: "bytes",
                                internalType: "bytes"
                            }
                        ]
                    },
                    {
                        name: "senderInfo",
                        type: "tuple",
                        internalType: "struct IStakeManager.StakeInfo",
                        components: [
                            {
                                name: "stake",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "unstakeDelaySec",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "factoryInfo",
                        type: "tuple",
                        internalType: "struct IStakeManager.StakeInfo",
                        components: [
                            {
                                name: "stake",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "unstakeDelaySec",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "paymasterInfo",
                        type: "tuple",
                        internalType: "struct IStakeManager.StakeInfo",
                        components: [
                            {
                                name: "stake",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "unstakeDelaySec",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "aggregatorInfo",
                        type: "tuple",
                        internalType: "struct IEntryPoint.AggregatorStakeInfo",
                        components: [
                            {
                                name: "aggregator",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "stakeInfo",
                                type: "tuple",
                                internalType: "struct IStakeManager.StakeInfo",
                                components: [
                                    {
                                        name: "stake",
                                        type: "uint256",
                                        internalType: "uint256"
                                    },
                                    {
                                        name: "unstakeDelaySec",
                                        type: "uint256",
                                        internalType: "uint256"
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "simulateValidationBulk",
        inputs: [
            {
                name: "userOps",
                type: "tuple[]",
                internalType: "struct PackedUserOperation[]",
                components: [
                    {
                        name: "sender",
                        type: "address",
                        internalType: "address"
                    },
                    { name: "nonce", type: "uint256", internalType: "uint256" },
                    { name: "initCode", type: "bytes", internalType: "bytes" },
                    { name: "callData", type: "bytes", internalType: "bytes" },
                    {
                        name: "accountGasLimits",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "preVerificationGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "gasFees",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "paymasterAndData",
                        type: "bytes",
                        internalType: "bytes"
                    },
                    { name: "signature", type: "bytes", internalType: "bytes" }
                ]
            }
        ],
        outputs: [
            {
                name: "",
                type: "tuple[]",
                internalType:
                    "struct IEntryPointSimulations.ValidationResult[]",
                components: [
                    {
                        name: "returnInfo",
                        type: "tuple",
                        internalType: "struct IEntryPoint.ReturnInfo",
                        components: [
                            {
                                name: "preOpGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "prefund",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "accountValidationData",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterValidationData",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterContext",
                                type: "bytes",
                                internalType: "bytes"
                            }
                        ]
                    },
                    {
                        name: "senderInfo",
                        type: "tuple",
                        internalType: "struct IStakeManager.StakeInfo",
                        components: [
                            {
                                name: "stake",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "unstakeDelaySec",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "factoryInfo",
                        type: "tuple",
                        internalType: "struct IStakeManager.StakeInfo",
                        components: [
                            {
                                name: "stake",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "unstakeDelaySec",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "paymasterInfo",
                        type: "tuple",
                        internalType: "struct IStakeManager.StakeInfo",
                        components: [
                            {
                                name: "stake",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "unstakeDelaySec",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "aggregatorInfo",
                        type: "tuple",
                        internalType: "struct IEntryPoint.AggregatorStakeInfo",
                        components: [
                            {
                                name: "aggregator",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "stakeInfo",
                                type: "tuple",
                                internalType: "struct IStakeManager.StakeInfo",
                                components: [
                                    {
                                        name: "stake",
                                        type: "uint256",
                                        internalType: "uint256"
                                    },
                                    {
                                        name: "unstakeDelaySec",
                                        type: "uint256",
                                        internalType: "uint256"
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "simulateValidationLast",
        inputs: [
            {
                name: "userOps",
                type: "tuple[]",
                internalType: "struct PackedUserOperation[]",
                components: [
                    {
                        name: "sender",
                        type: "address",
                        internalType: "address"
                    },
                    { name: "nonce", type: "uint256", internalType: "uint256" },
                    { name: "initCode", type: "bytes", internalType: "bytes" },
                    { name: "callData", type: "bytes", internalType: "bytes" },
                    {
                        name: "accountGasLimits",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "preVerificationGas",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "gasFees",
                        type: "bytes32",
                        internalType: "bytes32"
                    },
                    {
                        name: "paymasterAndData",
                        type: "bytes",
                        internalType: "bytes"
                    },
                    { name: "signature", type: "bytes", internalType: "bytes" }
                ]
            }
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                internalType: "struct IEntryPointSimulations.ValidationResult",
                components: [
                    {
                        name: "returnInfo",
                        type: "tuple",
                        internalType: "struct IEntryPoint.ReturnInfo",
                        components: [
                            {
                                name: "preOpGas",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "prefund",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "accountValidationData",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterValidationData",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "paymasterContext",
                                type: "bytes",
                                internalType: "bytes"
                            }
                        ]
                    },
                    {
                        name: "senderInfo",
                        type: "tuple",
                        internalType: "struct IStakeManager.StakeInfo",
                        components: [
                            {
                                name: "stake",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "unstakeDelaySec",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "factoryInfo",
                        type: "tuple",
                        internalType: "struct IStakeManager.StakeInfo",
                        components: [
                            {
                                name: "stake",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "unstakeDelaySec",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "paymasterInfo",
                        type: "tuple",
                        internalType: "struct IStakeManager.StakeInfo",
                        components: [
                            {
                                name: "stake",
                                type: "uint256",
                                internalType: "uint256"
                            },
                            {
                                name: "unstakeDelaySec",
                                type: "uint256",
                                internalType: "uint256"
                            }
                        ]
                    },
                    {
                        name: "aggregatorInfo",
                        type: "tuple",
                        internalType: "struct IEntryPoint.AggregatorStakeInfo",
                        components: [
                            {
                                name: "aggregator",
                                type: "address",
                                internalType: "address"
                            },
                            {
                                name: "stakeInfo",
                                type: "tuple",
                                internalType: "struct IStakeManager.StakeInfo",
                                components: [
                                    {
                                        name: "stake",
                                        type: "uint256",
                                        internalType: "uint256"
                                    },
                                    {
                                        name: "unstakeDelaySec",
                                        type: "uint256",
                                        internalType: "uint256"
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "unlockStake",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "withdrawStake",
        inputs: [
            {
                name: "withdrawAddress",
                type: "address",
                internalType: "address payable"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "withdrawTo",
        inputs: [
            {
                name: "withdrawAddress",
                type: "address",
                internalType: "address payable"
            },
            { name: "withdrawAmount", type: "uint256", internalType: "uint256" }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "event",
        name: "AccountDeployed",
        inputs: [
            {
                name: "userOpHash",
                type: "bytes32",
                indexed: true,
                internalType: "bytes32"
            },
            {
                name: "sender",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "factory",
                type: "address",
                indexed: false,
                internalType: "address"
            },
            {
                name: "paymaster",
                type: "address",
                indexed: false,
                internalType: "address"
            }
        ],
        anonymous: false
    },
    { type: "event", name: "BeforeExecution", inputs: [], anonymous: false },
    {
        type: "event",
        name: "Deposited",
        inputs: [
            {
                name: "account",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "totalDeposit",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "PostOpRevertReason",
        inputs: [
            {
                name: "userOpHash",
                type: "bytes32",
                indexed: true,
                internalType: "bytes32"
            },
            {
                name: "sender",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "nonce",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            },
            {
                name: "revertReason",
                type: "bytes",
                indexed: false,
                internalType: "bytes"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "SignatureAggregatorChanged",
        inputs: [
            {
                name: "aggregator",
                type: "address",
                indexed: true,
                internalType: "address"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "StakeLocked",
        inputs: [
            {
                name: "account",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "totalStaked",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            },
            {
                name: "unstakeDelaySec",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "StakeUnlocked",
        inputs: [
            {
                name: "account",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "withdrawTime",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "StakeWithdrawn",
        inputs: [
            {
                name: "account",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "withdrawAddress",
                type: "address",
                indexed: false,
                internalType: "address"
            },
            {
                name: "amount",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "UserOperationEvent",
        inputs: [
            {
                name: "userOpHash",
                type: "bytes32",
                indexed: true,
                internalType: "bytes32"
            },
            {
                name: "sender",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "paymaster",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "nonce",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            },
            {
                name: "success",
                type: "bool",
                indexed: false,
                internalType: "bool"
            },
            {
                name: "actualGasCost",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            },
            {
                name: "actualGasUsed",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "UserOperationPrefundTooLow",
        inputs: [
            {
                name: "userOpHash",
                type: "bytes32",
                indexed: true,
                internalType: "bytes32"
            },
            {
                name: "sender",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "nonce",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "UserOperationRevertReason",
        inputs: [
            {
                name: "userOpHash",
                type: "bytes32",
                indexed: true,
                internalType: "bytes32"
            },
            {
                name: "sender",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "nonce",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            },
            {
                name: "revertReason",
                type: "bytes",
                indexed: false,
                internalType: "bytes"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "Withdrawn",
        inputs: [
            {
                name: "account",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "withdrawAddress",
                type: "address",
                indexed: false,
                internalType: "address"
            },
            {
                name: "amount",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "error",
        name: "FailedOp",
        inputs: [
            { name: "opIndex", type: "uint256", internalType: "uint256" },
            { name: "reason", type: "string", internalType: "string" }
        ]
    },
    {
        type: "error",
        name: "FailedOpWithRevert",
        inputs: [
            { name: "opIndex", type: "uint256", internalType: "uint256" },
            { name: "reason", type: "string", internalType: "string" },
            { name: "inner", type: "bytes", internalType: "bytes" }
        ]
    },
    {
        type: "error",
        name: "PostOpReverted",
        inputs: [{ name: "returnData", type: "bytes", internalType: "bytes" }]
    },
    { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
    {
        type: "error",
        name: "SenderAddressResult",
        inputs: [{ name: "sender", type: "address", internalType: "address" }]
    },
    {
        type: "error",
        name: "SignatureValidationFailed",
        inputs: [
            { name: "aggregator", type: "address", internalType: "address" }
        ]
    },
    {
        type: "error",
        name: "SimulationOutOfGas",
        inputs: [
            { name: "optimalGas", type: "uint256", internalType: "uint256" },
            { name: "minGas", type: "uint256", internalType: "uint256" },
            { name: "maxGas", type: "uint256", internalType: "uint256" }
        ]
    },
    {
        type: "error",
        name: "innerCallResult",
        inputs: [
            { name: "remainingGas", type: "uint256", internalType: "uint256" }
        ]
    }
] as const

export const ENTRY_POINT_SIMULATIONS_CREATECALL: Hex =
    "0x313233340000000000000000000000000000000000000000000000000000000060808060405234610085576149d08181016001600160401b0381118382101761006f578291610400833903906000f0801561006357600080546001600160a01b0319166001600160a01b0392909216919091179055604051610375908161008b8239f35b6040513d6000823e3d90fd5b634e487b7160e01b600052604160045260246000fd5b600080fdfe60406080815260048036101561001457600080fd5b6000803560e01c63c18f52261461002a57600080fd5b346102825782600319360112610282576001600160a01b03600435818116939084900361027e57602492833567ffffffffffffffff80821161027e573660238301121561027e57816004013591610080836102bd565b9261008d8a519485610285565b808452602095888786019260051b8401019236841161027a57898101925b8484106101fb575050505050508051946100dc6100c7876102bd565b966100d48a519889610285565b8088526102bd565b601f199790880185855b8281106101eb57505050835b8984518210156101905790878680878761014f8f8d61014360019a61011d8b60609b8a541698610315565b5190805197889485019763428557b160e11b8952850152604484015260648301906102d5565b03908101845283610285565b82885a935193f115610178575b610166828b610315565b52610171818a610315565b50016100f2565b508a513d81810189018d52808252878983013e61015c565b805187815289518189018190528792600582901b83018101918c8b01918b9085015b8287106101bf5785850386f35b9091929382806101db600193603f198a820301865288516102d5565b96019201960195929190926101b2565b606082828c0101520186906100e6565b833586811161027657820136604382011215610276578b8101356044888211610264578f5192610234601f8401601f19168e0185610285565b82845236828483010111610260578c838196948296948f940183860137830101528152019301926100ab565b8b80fd5b634e487b7160e01b8b52604186528d8bfd5b8880fd5b8680fd5b8280fd5b80fd5b90601f8019910116810190811067ffffffffffffffff8211176102a757604052565b634e487b7160e01b600052604160045260246000fd5b67ffffffffffffffff81116102a75760051b60200190565b919082519283825260005b848110610301575050826000602080949584010152601f8019910116010190565b6020818301810151848301820152016102e0565b80518210156103295760209160051b010190565b634e487b7160e01b600052603260045260246000fdfea2646970667358221220ed8436f6b510411fd3e10745f3f0263a07ebd1140eed9265d864fde12e4648c264736f6c6343000817003360c08060405234620000e35760016002556101608181016001600160401b03811183821017620000cd57829162004870833903906000f08015620000c1576080523060a0526200004e620000e8565b6000815260208101906000825280602062000068620000e8565b600081520152600380546001600160a01b03191690555160045551600555604051614767908162000109823960805181505060a0518181816116eb015281816124890152818161266501528181612fa7015261311d0152f35b6040513d6000823e3d90fd5b634e487b7160e01b600052604160045260246000fd5b600080fd5b60408051919082016001600160401b03811183821017620000cd5760405256fe60806040526004361015610023575b361561001957600080fd5b610021612f52565b005b60003560e01c80630396cb60146101d357806303d1dcaf146101ce5780630bd28e3b146101c95780630da82661146101c45780630dbfc6bd146101bf5780631b2e01b8146101ba578063205c2878146101b557806321e60b37146101b057806322cdde4c146101ab578063263934db146101a657806330ec25d1146101a157806335567e1a1461019c57806344403473146101975780635287ce12146101925780635787f48b1461018d5780635895273b1461018857806369683cfa1461018357806370a082311461017e57806376ad6123146101795780637f75516614610174578063b760faf91461016f578063bb9fe6bf1461016a578063c23a5cea14610165578063c3bce00914610160578063f7e426e81461015b578063fc7e286d146101565763fe2171cb0361000e5761184b565b6117cc565b6116a4565b61165e565b61157d565b611495565b61146a565b611256565b6111fd565b6111c0565b610ffd565b610fd0565b610fb0565b610ea3565b610e57565b610d95565b610d1a565b610c03565b610be3565b610b33565b610957565b6108f4565b610879565b6106d8565b6104f4565b610462565b60203660031901126102fa5763ffffffff600435818116918282036102fa577fa5ae833d0bb1dcd632d98a8b70973e8516812898e19bf27b70071ebc8dc52c01916102d76102f59261025861023a3360018060a01b03166000526000602052604060002090565b9661024681151561189b565b6001880154928360781c1611156118e7565b6102b16102736001600160701b039283349160081c16611966565b9661027f881515611973565b61028b838911156119b4565b5491610295610604565b9283526001602084015287166001600160701b03166040830152565b63ffffffff831660608201526000608082018190523381526020819052604090206119f1565b6040805194855263ffffffff90911660208501523393918291820190565b0390a2005b600080fd5b9181601f840112156102fa578235916001600160401b0383116102fa576020808501948460051b0101116102fa57565b6001600160a01b038116036102fa57565b6024359061034d8261032f565b565b610104359061034d8261032f565b6044359061034d8261032f565b610124359061034d8261032f565b359061034d8261032f565b906003199060c0828401126102fa576001600160401b036004358181116102fa57846103b1916004016102ff565b949094936024359283116102fa57826060920301126102fa57600401906044356103da8161032f565b90606435906084359060a43590565b60005b8381106103fc5750506000910152565b81810151838201526020016103ec565b90602091610425815180928185528580860191016103e9565b601f01601f1916010190565b6080604061045f9360208452805160208501526020810151151582850152015191606080820152019061040c565b90565b346102fa576104da6104ce61047636610383565b94610485949194939293611a7e565b5061048e611a9f565b966104c961049c8480611b22565b6104bb6040519a8b926321e60b3760e01b602085015260248401611c4e565b03601f1981018a52896105e3565b612f5b565b60405191829182610431565b0390f35b602435906001600160c01b03821682036102fa57565b346102fa5760203660031901126102fa576004356001600160c01b03811681036102fa573360009081526001602090815260408083206001600160c01b039094168352929052206105458154611d19565b9055005b634e487b7160e01b600052604160045260246000fd5b60a081019081106001600160401b0382111761057a57604052565b610549565b6001600160401b03811161057a57604052565b606081019081106001600160401b0382111761057a57604052565b604081019081106001600160401b0382111761057a57604052565b602081019081106001600160401b0382111761057a57604052565b90601f801991011681019081106001600160401b0382111761057a57604052565b6040519061034d8261055f565b6040519061014082018281106001600160401b0382111761057a57604052565b6040519061034d82610592565b6040519061010082018281106001600160401b0382111761057a57604052565b6040519061034d826105ad565b6001600160401b03811161057a57601f01601f191660200190565b9291926106928261066b565b916106a060405193846105e3565b8294818452818301116102fa578281602093846000960137010152565b9080601f830112156102fa5781602061045f93359101610686565b346102fa576102203660031901126102fa576001600160401b036004358181116102fa5761070a9036906004016106bd565b366023190191906101c083126102fa576101406040519361072a8561055f565b126102fa57610737610611565b61073f610340565b815260443560208201526064356040820152608435606082015260a435608082015260c43560a082015260e43560c082015261077961034f565b60e0820152610124356101008201526101443561012082015283526101643560208401526101843560408401526101a43560608401526101c43560808401526101e4359182116102fa576040926107d76107e29336906004016106bd565b906102043592611d3f565b82519182526020820152f35b60206003198201126102fa57600435906001600160401b0382116102fa57610818916004016102ff565b9091565b9061045f9160e061010091805184526020810151602085015260408101516040850152606081015160608501526080810151608085015260a081015160a085015260c0810151151560c08501520151918160e0820152019061040c565b346102fa5761089061088a366107ee565b90611f5d565b60405160209160208201926020835281518094526040830193602060408260051b8601019301916000955b8287106108c85785850386f35b9091929382806108e4600193603f198a8203018652885161081c565b96019201960195929190926108bb565b346102fa5760403660031901126102fa57602061094e6004356109168161032f565b61091e6104de565b6001600160a01b0390911660009081526001845260408082206001600160c01b0390931682526020929092522090565b54604051908152f35b346102fa5760403660031901126102fa576004356109748161032f565b60243590600091338352826020526040832091825492838311610a0057848080808681966109fd966109a6838c611fc2565b9055604080516001600160a01b03831681526020810184905233917fd1c19fbcd4551a5edfb66d43d2e337c04837afda3482b42bdf569a8fccdae5fb91a26001600160a01b03165af16109f7611fe2565b50612012565b80f35b60405162461bcd60e51b815260206004820152601960248201527f576974686472617720616d6f756e7420746f6f206c61726765000000000000006044820152606490fd5b90816101209103126102fa5790565b6102006003198201126102fa57600435916024356001600160401b0381116102fa5782610a8391600401610a45565b91604319016101c081126102fa5761014060405191610aa18361055f565b126102fa57610aae610611565b610ab661035d565b81526064356020820152608435604082015260a435606082015260c435608082015260e43560a08201526101043560c0820152610af161036a565b60e0820152610144356101008201526101643561012082015281526101843560208201526101a43560408201526101c43560608201526101e435608082015290565b346102fa576060610b4336610a54565b9190600092805191610b7683610100604082015160608301510160808301510160a08301510160c0830151019101510290565b60e0909301516001600160a01b0316610ba2575b85856040519060008252602082015260006040820152f35b610bae94505a93613691565b905038808080610b8a565b60206003198201126102fa57600435906001600160401b0382116102fa5761045f91600401610a45565b346102fa576020610bfb610bf636610bb9565b612053565b604051908152f35b346102fa57610c2f610c14366107ee565b809291610c1f611e79565b50610c2982611ec7565b50611f5d565b6000198201918211610c5d576104da91610c4891611f49565b5160405191829160208352602083019061081c565b611933565b9061045f9060e06080610cb4816101408751908087528151908701526020810151610160870152604081015161018087015260608101516101a0870152015160a06101c08601526101e085019061040c565b60208087015180518683015201516040850152946040810151805160608601526020015160808501526060810151805160a08601526020015160c0850152015191019080516001600160a01b031682526020908101518051828401520151604090910152565b346102fa57610d31610d2b366107ee565b906121ec565b60405160209160208201926020835281518094526040830193602060408260051b8601019301916000955b828710610d695785850386f35b909192938280610d85600193603f198a82030186528851610c62565b9601920196019592919092610d5c565b346102fa5760403660031901126102fa576020600435610db48161032f565b610dbc6104de565b6001600160a01b0390911660009081526001835260408082206001600160c01b03841683526020529020546040805192901b67ffffffffffffffff1916178152f35b60606003198201126102fa57600435610e168161032f565b916024356001600160401b03928382116102fa57806023830112156102fa5781600401359384116102fa57602484830101116102fa57602401919060443590565b346102fa57610e6536610dfe565b90806040519384378201908260008095819585838097520393f1610e87611fe2565b9015610e91575080f35b8051918215610ea05750602001fd5b80fd5b346102fa5760203660031901126102fa576104da6080600435610ec58161032f565b60409182918251610ed58161055f565b60009281848093528260208201528286820152826060820152015260018060a01b03168152806020522090610f5e65ffffffffffff6001835194610f188661055f565b80548652015460ff8116151560208601526001600160701b038160081c168486015263ffffffff8160781c16606086015260981c16608084019065ffffffffffff169052565b5191829182919091608065ffffffffffff8160a0840195805185526020810151151560208601526001600160701b03604082015116604086015263ffffffff6060820151166060860152015116910152565b346102fa576104da6104ce610fc436610383565b959490949391936123d7565b346102fa576104da610fe9610fe436610bb9565b6127f3565b60405191829160208352602083019061081c565b346102fa5761100b36610a54565b9190915a9281519361101d8583613926565b61102682612053565b602084015260408501519361106a6001600160781b038660c08901511760608901511760808901511760a08901511761010089015117610120890151171115612929565b61109586610100604082015160608301510160808301510160a08301510160c0830151019101510290565b946110c56110c16110a95a89898988613c29565b89516020909a015190996001600160a01b0316613d3c565b1590565b611174575a8303116111235750926111069260806111019360a061110d975a9560408601526060808601525a9003910135019101525a90611fc2565b612975565b6064900490565b6040805192835260006020840152820152606090f35b60408051631101335b60e11b815260048101929092526024820152601e60448201527f41413236206f76657220766572696669636174696f6e4761734c696d697400006064820152608490fd5b0390fd5b60408051631101335b60e11b8152600481018490526024810191909152601a6044820152794141323520696e76616c6964206163636f756e74206e6f6e636560301b6064820152608490fd5b346102fa5760203660031901126102fa576004356111dd8161032f565b60018060a01b031660005260006020526020604060002054604051908152f35b346102fa576104da6104ce61121136610383565b94611220949194939293611a7e565b50611229611a9f565b966104c96112378480611b22565b6104bb6040519a8b926334b41e7d60e11b602085015260248401611c4e565b346102fa5761126436610a54565b91906000925a918151926112788483613926565b61128182612053565b60208401526040840151946112c56001600160781b038760c08801511760608801511760808801511760a08801511761010088015117610120880151171115612929565b6112f085610100604082015160608301510160808301510160a08301510160c0830151019101510290565b6112fd8782878786613c29565b865190979061131e906110c1906001600160a01b031660208a015190613d3c565b61141e575a8403116113cf576060915a60e097909701516001600160a01b0316611392575b509360806111069460a0611101956104da999561137599604087015260608601525a9003910135019101525a90611fc2565b604051938493846040919493926060820195825260208201520152565b8198506104da9692508460a0611101956113bd6080948a96876111069b886113759e51015193613691565b9c90969a509498509550509450611343565b60408051631101335b60e11b8152600481018490526024810191909152601e60448201527f41413236206f76657220766572696669636174696f6e4761734c696d697400006064820152608490fd5b60408051631101335b60e11b8152600481018590526024810191909152601a6044820152794141323520696e76616c6964206163636f756e74206e6f6e636560301b6064820152608490fd5b60203660031901126102fa576100216004356114858161032f565b612b68565b60009103126102fa57565b346102fa57600080600319360112610ea0573381528060205260016040822001805463ffffffff8160781c1690811561154b57611510916114db60ff6114e99316612bbf565b65ffffffffffff4216612bff565b825460ff65ffffffffffff60981b01191665ffffffffffff60981b609883901b1617909255565b60405165ffffffffffff91909116815233907ffa9b3c14cc825c412c9ed81b3ba365a5b459439403f18829e572ed53a4180f0a90602090a280f35b60405162461bcd60e51b815260206004820152600a6024820152691b9bdd081cdd185ad95960b21b6044820152606490fd5b346102fa5760203660031901126102fa5760043561159a8161032f565b3360009081526020819052604090206109fd90600101916116028354936115f165ffffffffffff6001600160701b038760081c16966115da881515612c19565b60981c166115e9811515612c5c565b421015612ca8565b8054610100600160c81b0319169055565b604080516001600160a01b03831681526020810185905233917fb7c918e0e249f999e965cafeb6c664271b3f4317d296461500e71da39f0cbda391a2600080808095819460018060a01b03165af1611658611fe2565b50612cf4565b346102fa576104da61167761167236610bb9565b612db9565b604051918291602083526020830190610c62565b60409061045f939215158152816020820152019061040c565b346102fa576116b236610dfe565b6060936000936001600160a01b03939184169290833b156102fa5760008094611714966040519788968795869363428557b160e11b85527f00000000000000000000000000000000000000000000000000000000000000001660048501612f1f565b0393f190816117b3575b506117ae57505061172d611fe2565b61173f61173a8251611fa4565b6122f7565b9060045b8151811015611788578061176a61175c60019385612f41565b516001600160f81b03191690565b61178161177683611fa4565b9160001a9186612f41565b5301611743565b505061179d9060208082518301019101612395565b905b6104da6040519283928361168b565b61179f565b806117c06117c69261057f565b8061148a565b3861171e565b346102fa5760203660031901126102fa576004356117e98161032f565b60018060a01b0316600052600060205260a0604060002065ffffffffffff6001825492015460405192835260ff8116151560208401526001600160701b038160081c16604084015263ffffffff8160781c16606084015260981c166080820152f35b346102fa5761186d61185c366107ee565b809291611867612165565b506121ec565b6000198201918211610c5d576104da9161188691611f49565b51604051918291602083526020830190610c62565b156118a257565b60405162461bcd60e51b815260206004820152601a60248201527f6d757374207370656369667920756e7374616b652064656c61790000000000006044820152606490fd5b156118ee57565b60405162461bcd60e51b815260206004820152601c60248201527f63616e6e6f7420646563726561736520756e7374616b652074696d65000000006044820152606490fd5b634e487b7160e01b600052601160045260246000fd5b906113888201809211610c5d57565b9060018201809211610c5d57565b91908201809211610c5d57565b1561197a57565b60405162461bcd60e51b81526020600482015260126024820152711b9bc81cdd185ad9481cdc1958da599a595960721b6044820152606490fd5b156119bb57565b60405162461bcd60e51b815260206004820152600e60248201526d7374616b65206f766572666c6f7760901b6044820152606490fd5b9065ffffffffffff6080600161034d948451815501926020810151151584546effffffffffffffffffffffffffff00604084015160081b169060ff63ffffffff60781b606086015160781b169316906cffffffffffffffffffffffffff60981b16171717845501511681549065ffffffffffff60981b9060981b169065ffffffffffff60981b1916179055565b60405190611a8b82610592565b606060408360008152600060208201520152565b60405190611aac8261055f565b6040516101408101836001600160401b0382118383101761057a5760809160405260009283815283602082015283604082015283606082015283838201528360a08201528360c08201528360e0820152836101008201528361012082015281528260208201528260408201528260608201520152565b90359061011e19813603018212156102fa570190565b9035601e19823603018112156102fa5701602081359101916001600160401b0382116102fa5781360383136102fa57565b908060209392818452848401376000828201840152601f01601f1916010190565b61045f91611c2f611bf6611bdb610120611bb485611ba788610378565b6001600160a01b03169052565b60208601356020860152611bcb6040870187611b38565b9091806040880152860191611b69565b611be86060860186611b38565b908583036060870152611b69565b6080840135608084015260a084013560a084015260c084013560c0840152611c2160e0850185611b38565b9084830360e0860152611b69565b91611c406101009182810190611b38565b929091818503910152611b69565b906080611c706101e09295949561020060008652806020870152850190611b8a565b855180516001600160a01b0316604086015290959060208101516060860152604081015183860152606081015160a08601528281015160c086015260a081015160e086015260c081015190610100918287015260e081015191611ce0610120938489019060018060a01b03169052565b8101516101408701520151610160850152602081015161018085015260408101516101a085015260608101516101c08501520151910152565b6000198114610c5d5760010190565b60409061045f93928152816020820152019061040c565b9190805193606085015194611d57603f5a0260061c90565b61271060a083015188010111611e2157610818956000958051611d87575b5050505a90036080820151019261329b565b8251611da1926110c19290916001600160a01b03166131c5565b611dad575b8080611d75565b909350611db86131d7565b8051611dca575b505060019238611da6565b602083810151835193909101516040516001600160a01b039094169391927f1c4fada7374c0a9ee8841fc38afe82932dc0f8e69012e927f061a8bae611a20192918291611e179183611d28565b0390a33880611dbf565b60408051631101335b60e11b8152600060048201526024810191909152600f60448201526e41413935206f7574206f662067617360881b6064820152608490fd5b6001600160401b03811161057a5760051b60200190565b6040519061010082018281106001600160401b0382111761057a57604052606060e083600080825280602083015280604083015280848301528060808301528060a083015260c08201520152565b90611ed182611e62565b611ede60405191826105e3565b8281528092611eef601f1991611e62565b019060005b828110611f0057505050565b602090611f0b611e79565b82828501015201611ef4565b634e487b7160e01b600052603260045260246000fd5b90821015611f445761045f9160051b810190611b22565b611f17565b8051821015611f445760209160051b010190565b611f6682611ec7565b9160005b818110611f775750505090565b80611f88610fe46001938587611f2d565b611f928287611f49565b52611f9d8186611f49565b5001611f6a565b600319810191908211610c5d57565b600019810191908211610c5d57565b91908203918211610c5d57565b60405190611fdc826105c8565b60008252565b3d1561200d573d90611ff38261066b565b9161200160405193846105e3565b82523d6000602084013e565b606090565b1561201957565b60405162461bcd60e51b81526020600482015260126024820152716661696c656420746f20776974686472617760701b6044820152606490fd5b61206060408201826122ad565b9081604051918237209061207760608201826122ad565b9081604051918237209161210361209a61209460e08501856122ad565b90614726565b6040805185356001600160a01b031660208083019182528701359282019290925260608101949094526080808501969096529484013560a08085019190915284013560c0808501919091529093013560e083015261010082019290925291908290610120820190565b0391612117601f19938481018352826105e3565b5190206040805160208101928352309181019190915246606082015260809283018152909161214690826105e3565b51902090565b60405190612159826105ad565b60006020838281520152565b604051906121728261055f565b8160405161217f8161055f565b600081526000602082015260006040820152600060608201526060608082015281526121a961214c565b60208201526121b661214c565b60408201526121c361214c565b60608201526080604051916121d7836105ad565b600083526121e361214c565b60208401520152565b6121f582611e62565b9161220360405193846105e3565b808352601f1961221282611e62565b0160005b81811061225c57505060005b81811061222f5750505090565b806122406116726001938587611f2d565b61224a8287611f49565b526122558186611f49565b5001612222565b602090612267612165565b82828801015201612216565b908092918237016000815290565b9190811015611f445760051b81013590605e19813603018212156102fa570190565b3561045f8161032f565b903590601e19813603018212156102fa57018035906001600160401b0382116102fa576020019181360383136102fa57565b6040516122eb816105c8565b60008152906000368137565b906123018261066b565b61230e60405191826105e3565b828152809261231f601f199161066b565b0190602036910137565b93929161234e9060409260018060a01b0316865260606020870152606086019061040c565b930152565b81601f820112156102fa5780516123698161066b565b9261237760405194856105e3565b818452602082840101116102fa5761045f91602080850191016103e9565b9190916040818403126102fa57805180151581036102fa579260208201516001600160401b0381116102fa5761045f9201612353565b6040513d6000823e3d90fd5b9693959194966123e5611a7e565b5060005b828110612731575050506123fd8480611b22565b9460209161240c8387016122a3565b946124416124296124226040998a8101906122ad565b3691610686565b98612432611a9f565b9061243c8161382c565b61298b565b506001600160a01b0392915050868216156127085788600088878b8815612605575050505050600193612484612475611fcf565b919592949b93919b5b86611966565b9081907f0000000000000000000000000000000000000000000000000000000000000000169b5b846124b68885611fc2565b106125da575a6124c588611949565b116125b15791869593918a95938e8d8f8c6124e28f9d8890611966565b60011c9a8b8451938493634440347360e01b90850152602484019261250693612329565b03601f198101825261251890826105e3565b5a9151631efc84dd60e31b81529b8c9283926125379260048501612329565b03815a6000948591f19889156125ac57600090819a612586575b50156125715750505061256384611fb3565b95915b9390929495916124ab565b93965094612580919750611958565b94612566565b906125a4929a503d8091833e61259c81836105e3565b810190612395565b989038612551565b6123cb565b508951637162685f60e11b81526004810191909152602481018690526044810191909152606490fd5b9998509950509392505096506125ff92506125f3610631565b95865285019015159052565b82015290565b61265f9498508397939291612634612642925a9b5a9151958694634440347360e01b9086015260248501612329565b03601f1981018352826105e3565b5a8c51631efc84dd60e31b81529485928392908d60048501612329565b038183887f0000000000000000000000000000000000000000000000000000000000000000165af19182156125ac578580936126e7575b5050816126a586975a90611fc2565b9580156126bf575050612484909b93919b9592949561247e565b979b50999850505098505050506125ff91506126d9610631565b946000865285019015159052565b909195506126ff92503d8091833e61259c81836105e3565b90933880612696565b9850505050935050506127196122df565b906000612724610631565b9381855284015282015290565b60019061273c611a9f565b61276761274a838787612281565b9161275d6127588480611b22565b61382c565b61243c8380611b22565b5050506020810161278661277a826122a3565b6001600160a01b031690565b156127ce576000916127b98361279c81946122a3565b926127ac604091828101906122ad565b9390915180948193612273565b03925af1506127c6611fe2565b505b016123e9565b50506127c8565b604051906127e2826105ad565b6002825261060f60f31b6020830152565b6127fb611e79565b50600280541461291757600280556080612813611a9f565b9161281d8161382c565b612827838261298b565b926000929192905a908760608101519161284460608201826122ad565b6003811161290e575b638dd7712f60e01b966001600160e01b03191687036128f55750506128a76128ac9560208401516128936040519485936020850152604060248501526064840190611b8a565b90604483015203601f1981018352826105e3565b611d3f565b9490955b0151946128bb61063e565b958652602086015260408501526060840152608083015260a0820152600060c08201526128e66127d5565b60e082015261045f6001600255565b61290696506128a792503691610686565b9490956128b0565b8135965061284d565b604051633ee5aeb560e01b8152600490fd5b1561293057565b60405162461bcd60e51b815260206004820152601860248201527f41413934206761732076616c756573206f766572666c6f7700000000000000006044820152606490fd5b90607382029180830460731490151715610c5d57565b90916000915a9380519161299f8382613926565b6129a881612053565b60208301526040830151956129ec6001600160781b038860c08701511760608701511760808701511760a08701511761010087015117610120870151171115612929565b612a1784610100604082015160608301510160808301510160a08301510160c0830151019101510290565b612a2388828686613a84565b8551909890612a44906110c1906001600160a01b0316602089015190613d3c565b612b1c575a830311612acd576060905a60e096909601516001600160a01b0316612a97575b6111019360a061045f9794879460809460406111069a015260608601525a9003910135019101525a90611fc2565b965050928260806111019360a061045f97612abb84611106995101518c878661350e565b9b909598509350949750509350612a69565b60408051631101335b60e11b8152600060048201526024810191909152601e60448201527f41413236206f76657220766572696669636174696f6e4761734c696d697400006064820152608490fd5b60408051631101335b60e11b8152600060048201526024810191909152601a6044820152794141323520696e76616c6964206163636f756e74206e6f6e636560301b6064820152608490fd5b6001805b60058110612bb85750507f2da466a7b24304f47e87fa2e1e5a81b9831ce54fec19055ce277ca2f39ba42c46020612ba33484613f7c565b6040519081526001600160a01b0390931692a2565b8101612b6c565b15612bc657565b60405162461bcd60e51b8152602060048201526011602482015270616c726561647920756e7374616b696e6760781b6044820152606490fd5b91909165ffffffffffff80809416911601918211610c5d57565b15612c2057565b60405162461bcd60e51b81526020600482015260146024820152734e6f207374616b6520746f20776974686472617760601b6044820152606490fd5b15612c6357565b60405162461bcd60e51b815260206004820152601d60248201527f6d7573742063616c6c20756e6c6f636b5374616b6528292066697273740000006044820152606490fd5b15612caf57565b60405162461bcd60e51b815260206004820152601b60248201527f5374616b65207769746864726177616c206973206e6f742064756500000000006044820152606490fd5b15612cfb57565b60405162461bcd60e51b815260206004820152601860248201527f6661696c656420746f207769746864726177207374616b6500000000000000006044820152606490fd5b906014116102fa5790601490565b6bffffffffffffffffffffffff199035818116939260148110612d7057505050565b60140360031b82901b16169150565b60405190612d8c826105ad565b6003546001600160a01b03168252604051602083612da9836105ad565b6004548352600554828401520152565b612dc1612165565b50612dca611a9f565b90612dd48161382c565b612dde828261298b565b50919092612dec8385613d7c565b805160e00151612e09906001600160a01b0316613e82565b613e82565b815151909290612e3990612e25906001600160a01b0316613e82565b91612e2e61214c565b5060408101906122ad565b9060148210612f1357612e5b612e55612e6193612e0493612d40565b90612d4e565b60601c90565b9160018060a01b038616946080820151966060604084015193015192612e85610604565b9889526020890152604088015260608701526080860152612ea4612d7f565b9380151580612f08575b612ed6575b50612ebc610604565b948552602085015260408401526060830152608082015290565b909350612ee281613e82565b612efc612eed61065e565b6001600160a01b039093168352565b60208201529238612eb3565b506001811415612eae565b5050612e616000613e82565b6001600160a01b03909116815260406020820181905261045f93910191611b69565b908151811015611f44570160200190565b61034d33612b68565b91612f7d61275892612f83949a95999a98969798612f77611a7e565b50613ec4565b80611b22565b600083156130f15750600190612fa5612f9a611fcf565b959291935b85611966565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169581905b84612fde8885611fc2565b106130c7575a612fed88611949565b1161309d57918695939160009593868b8b8e61301561300f886130359f611966565b60011c90565b9a8b936040519e8f9586948593631efc84dd60e31b855260048501612329565b03925af19889156125ac57600090819a61307f575b501561306a5750505061305c84611fb3565b95915b939092949591612fd3565b93965094613079919750611958565b9461305f565b90613095929a503d8091833e61259c81836105e3565b98903861304a565b50604051637162685f60e11b81526004810191909152602481018690526044810191909152606490fd5b9650965050919550506130e991506130dd610631565b93845215156020840152565b604082015290565b925090613118915a91845a60405180968192631efc84dd60e31b83528c8c60048501612329565b0381837f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165af19384156125ac578580956131a1575b5050839461316681945a90611fc2565b94811561317e575050612fa590959291939495612f9f565b965096505095505050506130e9613193610631565b600081529215156020840152565b909194506131ba9295503d8091833e61259c81836105e3565b939093923880613156565b9060009283809360208451940192f190565b3d6108008082116131fe575b50604051906020818301016040528082526000602083013e90565b9050386131e3565b6003111561321057565b634e487b7160e01b600052602160045260246000fd5b909493929460038110156132105760609261324e91835260806020840152608083019061040c565b9460408201520152565b9060a061045f926000815260606020820152601460608201527310504d4c081c1bdcdd13dc081c995d995c9d195960621b6080820152816040820152019061040c565b9093916000935a928651926132af84613f52565b60e08501519091906001600160a01b0316808061339457505084516001600160a01b03169050925b5a8603019360a06060820151910151019060808901918251860390818111613380575b505084029160408901928351948186106000146133565750508061331f600292613206565b0361333b57505061034d9250809561333681614064565b613fa3565b9150915061034d925a90039051019051856133368297614064565b9061034d9750809a945061336f92935080950390613f7c565b5061337981613206565b1590614004565b6064919003600a02049094019338806132fa565b949180516133a4575b50506132d7565b6133ad85613206565b600285031561339d57909198505a9160a087015191813b156102fa57859285600080948e6133f484604051998a9889978895637c627b2160e01b8752029160048601613226565b0393f19081613432575b506134275761117061340e6131d7565b6040516365c8fd4d60e01b815291829160048301613258565b5a900396388061339d565b806117c061343f9261057f565b386133fe565b91906040838203126102fa5782516001600160401b0381116102fa5760209161346f918501612353565b92015190565b61348d60409295949395606083526060830190611b8a565b9460208201520152565b9060a061045f926000815260606020820152600d60608201526c10504cccc81c995d995c9d1959609a1b6080820152816040820152019061040c565b60a09061045f9392815260606020820152600d60608201526c10504cccc81c995d995c9d1959609a1b6080820152816040820152019061040c565b939192905a815160e001516001600160a01b031660008181526020819052604090208054979296929083891061364257602060009586928661356d9c039055015191604051998a95869485936314add44b60e21b855260048501613475565b03926001600160a01b031686f1938460009160009661361b575b506135b0576111706135976131d7565b6040516365c8fd4d60e01b815291829160048301613497565b93925a9003116135bc57565b60408051631101335b60e11b8152600060048201526024810191909152602760448201527f41413336206f766572207061796d6173746572566572696669636174696f6e47606482015266185cd31a5b5a5d60ca1b608482015260a490fd5b90955061363b91503d806000833e61363381836105e3565b810190613445565b9438613587565b60408051631101335b60e11b8152600060048201526024810191909152601e60448201527f41413331207061796d6173746572206465706f73697420746f6f206c6f7700006064820152608490fd5b93909294915a815160e001516001600160a01b0316600081815260208190526040902091959092909180548981106137c5578990039055602001516040516314add44b60e21b81529697600093889390928492869284926136f6929160048501613475565b03926001600160a01b031686f193846000916000966137a6575b5061373b578561371e6131d7565b6040516365c8fd4d60e01b815291829161117091600484016134d3565b9491925a9003116137495750565b60408051631101335b60e11b815260048101929092526024820152602760448201527f41413336206f766572207061796d6173746572566572696669636174696f6e47606482015266185cd31a5b5a5d60ca1b608482015260a490fd5b9095506137be91503d806000833e61363381836105e3565b9438613710565b60408051631101335b60e11b8152600481018b90526024810191909152601e60448201527f41413331207061796d6173746572206465706f73697420746f6f206c6f7700006064820152608490fd5b90604061045f9260008152816020820152019061040c565b6040516135a560f21b602082019081523060601b6022830152600160f81b6036830152601782526138b4929190613862826105ad565b60018060a01b0391519020166bffffffffffffffffffffffff60a01b600654161760065561389360408201826122ad565b90506138ac6138a1836122a3565b9260e08101906122ad565b9290916140a6565b80516138bd5750565b604051631101335b60e11b81529081906111709060048301613814565b156138e157565b60405162461bcd60e51b815260206004820152601d60248201527f4141393320696e76616c6964207061796d6173746572416e64446174610000006044820152606490fd5b6139ab90613943613936826122a3565b6001600160a01b03168452565b602081013560208401526139676080820135906001600160801b038260801c921690565b6060850152604084015260a081013560c084015261399560c0820135906001600160801b038260801c921690565b61010085015261012084015260e08101906122ad565b9081156139e7576139cf8260e0926139ca603461034d979610156138da565b614160565b60a085015260808401526001600160a01b0316910152565b505060a081600060e0819401528260808201520152565b908160209103126102fa575190565b9060a061045f926000815260606020820152600d60608201526c10504c8cc81c995d995c9d1959609a1b6080820152816040820152019061040c565b60a09061045f9392815260606020820152600d60608201526c10504c8cc81c995d995c9d1959609a1b6080820152816040820152019061040c565b9093926020613b0b91865193613acb60e0613aa5875160018060a01b031690565b96613abd613ab660408601866122ad565b908d6141b7565b01516001600160a01b031690565b6001600160a01b039081161598600093919291908a613bec575b8501516040516306608bdf60e21b81529687958694600094938693929160048501613475565b0393881690f160009181613bbb575b50613b4357611170613b2a6131d7565b6040516365c8fd4d60e01b815291829160048301613a0d565b93613b4c575050565b6001600160a01b03166000908152602081905260409020908154808211613b7257039055565b60408051631101335b60e11b8152600060048201526024810191909152601760448201527610504c8c48191a591b89dd081c185e481c1c99599d5b99604a1b6064820152608490fd5b613bde91925060203d602011613be5575b613bd681836105e3565b8101906139fe565b9038613b1a565b503d613bcc565b6001600160a01b038816600090815260208190526040812054919550919089811115613c20575085825b9591925050613ae5565b86908a03613c16565b949291936020613c6691865193613acb60e0613c4b875160018060a01b031690565b96613abd8b8d613c5e60408801886122ad565b929091614412565b0393881690f160009181613d1b575b50613ca05785613c836131d7565b6040516365c8fd4d60e01b81529182916111709160048401613a49565b949293613cac57505050565b6001600160a01b0316600090815260208190526040902091825490818311613cd45750039055565b60408051631101335b60e11b815260048101929092526024820152601760448201527610504c8c48191a591b89dd081c185e481c1c99599d5b99604a1b6064820152608490fd5b613d3591925060203d602011613be557613bd681836105e3565b9038613c75565b6001600160a01b0316600090815260016020908152604080832084821c845290915290208054916001600160401b0391613d7584611d19565b9055161490565b613d859061464c565b6001600160a01b0392918316613e3f57613df057613da29061464c565b5016613daa57565b60408051631101335b60e11b8152600060048201526024810191909152601460448201527320a0999a1039b4b3b730ba3ab9329032b93937b960611b6064820152608490fd5b60408051631101335b60e11b8152600060048201526024810191909152601760448201527f414132322065787069726564206f72206e6f74206475650000000000000000006064820152608490fd5b6084604051631101335b60e11b81526000600482015260406024820152601460448201527320a0991a1039b4b3b730ba3ab9329032b93937b960611b6064820152fd5b90613e8b61214c565b9160018060a01b0316600052600060205263ffffffff6001604060002001546001600160701b038160081c16845260781c166020830152565b60005b828110613ed357505050565b600190613ede611a9f565b613eec61274a838787612281565b505050602081013590613efe8261032f565b838060a01b03821615613f4b576000918291613f198261032f565b82613f29604092838101906122ad565b8093519384928337810182815203925af150613f43611fe2565b505b01613ec7565b5050613f45565b610120610100820151910151808214613f7857480180821015613f73575090565b905090565b5090565b60018060a01b0316600052600060205260406000208054918201809211610c5d5781905590565b9190917f49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f6080602083015192519460018060a01b03946020868851169660e089015116970151916040519283526000602084015260408301526060820152a4565b9060807f49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f91602084015193519560018060a01b03956020878951169760e08a015116980151926040519384521515602084015260408301526060820152a4565b60208101519051907f67b4fa9642f42120bf031f3051d1824b0fe25627945b27b8a6a65d5761d5482e60208060018060a01b03855116940151604051908152a3565b929192159081614156575b5061411b5760148110156140ca575b505061045f611fcf565b6014116102fa573560601c3b156140e25738806140c0565b6040516140ee816105ad565b601b81527f41413330207061796d6173746572206e6f74206465706c6f7965640000000000602082015290565b5050604051614129816105ad565b601981527f41413230206163636f756e74206e6f74206465706c6f79656400000000000000602082015290565b90503b15386140b1565b90806014116102fa57806024116102fa576034116102fa57803560601c916024601483013560801c92013560801c90565b908160209103126102fa575161045f8161032f565b91602061045f938181520191611b69565b90826141c257505050565b8151516001600160a01b031692833b6143c3576006546001600160a01b03929060009084169360206040958688510151875180958193632b870d1b60e11b8352826142118b8b600484016141a6565b0393f19182156125ac57600092614392575b5080821696871561434657168096036142fa573b156142ae57612e5b612e557fd51a9c61267aa6196961883ecf5ff2da6619c37dac0fa92122513fb32c032d2d949361426e93612d40565b6020840151935160e001516142a9906001600160a01b03165b92516001600160a01b0392831681529190921660208201529081906040820190565b0390a3565b8251631101335b60e11b81526000600482015260406024820152602060448201527f4141313520696e6974436f6465206d757374206372656174652073656e6465726064820152608490fd5b8351631101335b60e11b81526000600482015260406024820152602060448201527f4141313420696e6974436f6465206d7573742072657475726e2073656e6465726064820152608490fd5b8551631101335b60e11b81526000600482015260406024820152601b60448201527f4141313320696e6974436f6465206661696c6564206f72204f4f4700000000006064820152608490fd5b6143b591925060203d6020116143bc575b6143ad81836105e3565b810190614191565b9038614223565b503d6143a3565b60408051631101335b60e11b8152600060048201526024810191909152601f60448201527f414131302073656e64657220616c726561647920636f6e7374727563746564006064820152608490fd5b90919280614421575b50505050565b8251516001600160a01b031693843b6145fd576006546001600160a01b03939060009085169460206040968789510151885180958193632b870d1b60e11b8352826144708c8c600484016141a6565b0393f19182156125ac576000926145dc575b508082169788156145905716809703614544573b156144f75750612e5b612e557fd51a9c61267aa6196961883ecf5ff2da6619c37dac0fa92122513fb32c032d2d94936144ce93612d40565b6020840151935160e001516144eb906001600160a01b0316614287565b0390a33880808061441b565b8351631101335b60e11b8152600481019190915260406024820152602060448201527f4141313520696e6974436f6465206d757374206372656174652073656e6465726064820152608490fd5b8451631101335b60e11b81526004810183905260406024820152602060448201527f4141313420696e6974436f6465206d7573742072657475726e2073656e6465726064820152608490fd5b8651631101335b60e11b81526004810185905260406024820152601b60448201527f4141313320696e6974436f6465206661696c6564206f72204f4f4700000000006064820152608490fd5b6145f691925060203d6020116143bc576143ad81836105e3565b9038614482565b60408051631101335b60e11b8152600481018590526024810191909152601f60448201527f414131302073656e64657220616c726561647920636f6e7374727563746564006064820152608490fd5b801561471d5760006040805161466181610592565b828152826020820152015265ffffffffffff90818160a01c16918215614713575b506146f5906146dc6146d16040519461469a86610592565b6001600160a01b03841686526146bf602087019460d01c859065ffffffffffff169052565b65ffffffffffff166040860181905290565b65ffffffffffff1690565b42119081156146f8575b5091516001600160a01b031690565b91565b5161470b915065ffffffffffff166146d1565b4210386146e6565b91506146f5614682565b50600090600090565b81604051918237209056fea2646970667358221220f17ba8be36e41aeb3ca1005b09255e534c238bfe6627316bff7f5ad4c94bce7e64736f6c634300081700336080806040523461001657610144908161001c8239f35b600080fdfe6080600436101561000f57600080fd5b6000803560e01c63570e1a361461002557600080fd5b3461010b57602036600319011261010b576004359167ffffffffffffffff9081841161010757366023850112156101075783600401358281116101035736602482870101116101035780601411610103576013198101928084116100ef57600b8201601f19908116603f01168301908111838210176100ef5792846024819482600c60209a968b9960405286845289840196603889018837830101525193013560601c5af190805191156100e7575b506040516001600160a01b039091168152f35b9050386100d4565b634e487b7160e01b85526041600452602485fd5b8380fd5b8280fd5b80fdfea26469706673582212200cb757f1fdb608281be803e114ca10044ba5d6804f8fe7715f297793ec636d0564736f6c63430008170033"
