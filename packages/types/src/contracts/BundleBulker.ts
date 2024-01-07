export const bundleBulkerAbi = [
    {
        stateMutability: 'view',
        type: 'function',
        inputs: [],
        name: 'ENTRY_POINT',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
    },
    {
        stateMutability: 'view',
        type: 'function',
        inputs: [{ name: '', internalType: 'uint32', type: 'uint32' }],
        name: 'idToInflator',
        outputs: [{ name: '', internalType: 'address', type: 'address' }],
    },
    {
        stateMutability: 'view',
        type: 'function',
        inputs: [{ name: 'compressed', internalType: 'bytes', type: 'bytes' }],
        name: 'inflate',
        outputs: [
            {
                name: 'ops',
                internalType: 'struct UserOperation[]',
                type: 'tuple[]',
                components: [
                    { name: 'sender', internalType: 'address', type: 'address' },
                    { name: 'nonce', internalType: 'uint256', type: 'uint256' },
                    { name: 'initCode', internalType: 'bytes', type: 'bytes' },
                    { name: 'callData', internalType: 'bytes', type: 'bytes' },
                    { name: 'callGasLimit', internalType: 'uint256', type: 'uint256' },
                    {
                        name: 'verificationGasLimit',
                        internalType: 'uint256',
                        type: 'uint256',
                    },
                    {
                        name: 'preVerificationGas',
                        internalType: 'uint256',
                        type: 'uint256',
                    },
                    { name: 'maxFeePerGas', internalType: 'uint256', type: 'uint256' },
                    {
                        name: 'maxPriorityFeePerGas',
                        internalType: 'uint256',
                        type: 'uint256',
                    },
                    { name: 'paymasterAndData', internalType: 'bytes', type: 'bytes' },
                    { name: 'signature', internalType: 'bytes', type: 'bytes' },
                ],
            },
            { name: 'beneficiary', internalType: 'address payable', type: 'address' },
        ],
    },
    {
        stateMutability: 'view',
        type: 'function',
        inputs: [{ name: '', internalType: 'address', type: 'address' }],
        name: 'inflatorToID',
        outputs: [{ name: '', internalType: 'uint32', type: 'uint32' }],
    },
    {
        stateMutability: 'nonpayable',
        type: 'function',
        inputs: [
            { name: 'inflatorId', internalType: 'uint32', type: 'uint32' },
            { name: 'inflator', internalType: 'address', type: 'address' },
        ],
        name: 'registerInflator',
        outputs: [],
    },
    {
        stateMutability: 'nonpayable',
        type: 'function',
        inputs: [{ name: 'compressed', internalType: 'bytes', type: 'bytes' }],
        name: 'submit',
        outputs: [],
    },
] as const;
