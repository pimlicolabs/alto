export const BundleBulkerAbi = [
    {
        type: "fallback",
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "ENTRY_POINT",
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
                internalType: "contract IInflator"
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
                name: "ops",
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
                name: "beneficiary",
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
                internalType: "contract IInflator"
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
        name: "registerInflator",
        inputs: [
            {
                name: "inflatorId",
                type: "uint32",
                internalType: "uint32"
            },
            {
                name: "inflator",
                type: "address",
                internalType: "contract IInflator"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    }
] as const
