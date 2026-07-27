// Viem's multicall3Abi only exposes the view-path aggregate3.
export const aggregate3ValueAbi = [
    {
        inputs: [
            {
                components: [
                    { name: "target", type: "address" },
                    { name: "allowFailure", type: "bool" },
                    { name: "value", type: "uint256" },
                    { name: "callData", type: "bytes" }
                ],
                name: "calls",
                type: "tuple[]"
            }
        ],
        name: "aggregate3Value",
        outputs: [
            {
                components: [
                    { name: "success", type: "bool" },
                    { name: "returnData", type: "bytes" }
                ],
                name: "returnData",
                type: "tuple[]"
            }
        ],
        stateMutability: "payable",
        type: "function"
    }
] as const
