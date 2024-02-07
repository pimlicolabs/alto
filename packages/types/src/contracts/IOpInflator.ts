// biome-ignore lint/style/useNamingConvention: conform to interface naming schema
export const IOpInflatorAbi = [
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
                name: "op",
                type: "tuple",
                internalType: "struct UserOperation",
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
            }
        ],
        stateMutability: "view"
    }
] as const
