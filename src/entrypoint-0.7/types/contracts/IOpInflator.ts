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
                ]
            }
        ],
        stateMutability: "view"
    }
] as const
