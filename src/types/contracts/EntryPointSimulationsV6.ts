export const EntryPointV06SimulationsAbi = [
    {
        inputs: [
            {
                name: "reason",
                type: "string"
            }
        ],
        name: "Error",
        type: "error"
    },
    // source: https://github.com/pimlicolabs/entrypoint-estimations/blob/6f6f343/src/v06/ModifiedEntryPoint.sol#L46
    {
        type: "error",
        name: "CallPhaseReverted",
        inputs: [
            {
                name: "reason",
                type: "bytes",
                internalType: "bytes"
            }
        ]
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
    }
] as const
