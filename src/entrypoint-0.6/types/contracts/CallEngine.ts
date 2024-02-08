export const CallEngineAbi = [
    {
        inputs: [
            {
                components: [
                    {
                        internalType: "address",
                        name: "to",
                        type: "address"
                    },
                    {
                        internalType: "uint256",
                        name: "value",
                        type: "uint256"
                    },
                    {
                        internalType: "bytes",
                        name: "data",
                        type: "bytes"
                    }
                ],
                internalType: "struct Instruction[]",
                name: "instructions",
                type: "tuple[]"
            }
        ],
        name: "execute",
        outputs: [],
        stateMutability: "payable",
        type: "function"
    },
    {
        stateMutability: "payable",
        type: "receive"
    }
] as const
