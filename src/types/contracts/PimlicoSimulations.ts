export const PimlicoEntryPointSimulationsAbi =
    [
  {
    "type": "constructor",
    "inputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "filterOps06",
    "inputs": [
      {
        "name": "userOps",
        "type": "tuple[]",
        "internalType": "struct UserOperation[]",
        "components": [
          {
            "name": "sender",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "initCode",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "callData",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "callGasLimit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "verificationGasLimit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "preVerificationGas",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxFeePerGas",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxPriorityFeePerGas",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "paymasterAndData",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      },
      {
        "name": "beneficiary",
        "type": "address",
        "internalType": "address payable"
      },
      {
        "name": "entryPoint",
        "type": "address",
        "internalType": "contract IEntryPoint"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PimlicoSimulations.FilterOpsResult",
        "components": [
          {
            "name": "gasUsed",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "balanceChange",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rejectedUserOps",
            "type": "tuple[]",
            "internalType": "struct PimlicoSimulations.RejectedUserOp[]",
            "components": [
              {
                "name": "userOpHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "revertReason",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "filterOps07",
    "inputs": [
      {
        "name": "userOps",
        "type": "tuple[]",
        "internalType": "struct PackedUserOperation[]",
        "components": [
          {
            "name": "sender",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "initCode",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "callData",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "accountGasLimits",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "preVerificationGas",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "gasFees",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "paymasterAndData",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      },
      {
        "name": "beneficiary",
        "type": "address",
        "internalType": "address payable"
      },
      {
        "name": "entryPoint",
        "type": "address",
        "internalType": "contract IEntryPoint"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PimlicoSimulations.FilterOpsResult",
        "components": [
          {
            "name": "gasUsed",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "balanceChange",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rejectedUserOps",
            "type": "tuple[]",
            "internalType": "struct PimlicoSimulations.RejectedUserOp[]",
            "components": [
              {
                "name": "userOpHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "revertReason",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "filterOps08",
    "inputs": [
      {
        "name": "userOps",
        "type": "tuple[]",
        "internalType": "struct PackedUserOperation[]",
        "components": [
          {
            "name": "sender",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "initCode",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "callData",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "accountGasLimits",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "preVerificationGas",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "gasFees",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "paymasterAndData",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      },
      {
        "name": "beneficiary",
        "type": "address",
        "internalType": "address payable"
      },
      {
        "name": "entryPoint",
        "type": "address",
        "internalType": "contract IEntryPoint"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PimlicoSimulations.FilterOpsResult",
        "components": [
          {
            "name": "gasUsed",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "balanceChange",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rejectedUserOps",
            "type": "tuple[]",
            "internalType": "struct PimlicoSimulations.RejectedUserOp[]",
            "components": [
              {
                "name": "userOpHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "revertReason",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "simulateEntryPoint",
    "inputs": [
      {
        "name": "entryPointSimulation",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "entryPoint",
        "type": "address",
        "internalType": "address payable"
      },
      {
        "name": "data",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "PimlicoSimulationV7Deployed",
    "inputs": [],
    "anonymous": false
  }
] as const
