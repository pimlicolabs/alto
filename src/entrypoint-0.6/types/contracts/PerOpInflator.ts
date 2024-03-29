export const PerOpInflatorAbi = [
    {
        type: "constructor",
        inputs: [
            {
                name: "_owner",
                type: "address",
                internalType: "address"
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "beneficiary",
        inputs: [],
        outputs: [
            {
                name: "",
                type: "address",
                internalType: "address payable"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "idToInflator",
        inputs: [
            {
                name: "",
                type: "uint32",
                internalType: "uint32"
            }
        ],
        outputs: [
            {
                name: "",
                type: "address",
                internalType: "contract IOpInflator"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "inflate",
        inputs: [
            {
                name: "compressed",
                type: "bytes",
                internalType: "bytes"
            }
        ],
        outputs: [
            {
                name: "",
                type: "tuple[]",
                internalType: "struct UserOperation[]",
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
                        name: "callGasLimit",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "verificationGasLimit",
                        type: "uint256",
                        internalType: "uint256"
                    },
                    {
                        name: "preVerificationGas",
                        type: "uint256",
                        internalType: "uint256"
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
                name: "",
                type: "address",
                internalType: "address payable"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "inflatorToID",
        inputs: [
            {
                name: "",
                type: "address",
                internalType: "contract IOpInflator"
            }
        ],
        outputs: [
            {
                name: "",
                type: "uint32",
                internalType: "uint32"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "owner",
        inputs: [],
        outputs: [
            {
                name: "",
                type: "address",
                internalType: "address"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "registerOpInflator",
        inputs: [
            {
                name: "inflatorId",
                type: "uint32",
                internalType: "uint32"
            },
            {
                name: "inflator",
                type: "address",
                internalType: "contract IOpInflator"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "renounceOwnership",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "setBeneficiary",
        inputs: [
            {
                name: "_beneficiary",
                type: "address",
                internalType: "address payable"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "transferOwnership",
        inputs: [
            {
                name: "newOwner",
                type: "address",
                internalType: "address"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "event",
        name: "OwnershipTransferred",
        inputs: [
            {
                name: "previousOwner",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "newOwner",
                type: "address",
                indexed: true,
                internalType: "address"
            }
        ],
        anonymous: false
    }
] as const
