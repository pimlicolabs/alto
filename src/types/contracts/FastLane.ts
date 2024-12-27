export const FastLaneAbi = [
    {
        inputs: [
            { internalType: "bytes32", name: "oppTxHash", type: "bytes32" },
            {
                internalType: "uint256",
                name: "oppTxMaxFeePerGas",
                type: "uint256"
            },
            {
                internalType: "uint256",
                name: "oppTxMaxPriorityFeePerGas",
                type: "uint256"
            },
            { internalType: "address", name: "fastLaneSigner", type: "address" }
        ],
        name: "getBackrunUserOpHash",
        outputs: [
            { internalType: "bytes32", name: "userOpHash", type: "bytes32" }
        ],
        stateMutability: "view",
        type: "function"
    }
] as const
