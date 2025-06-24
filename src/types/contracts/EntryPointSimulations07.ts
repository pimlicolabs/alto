export const entryPointSimulations07Abi = [
  {
    "type": "function",
    "name": "binarySearchCallGas",
    "inputs": [
      {
        "name": "queuedUserOps",
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
        "name": "targetUserOp",
        "type": "tuple",
        "internalType": "struct PackedUserOperation",
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
        "name": "entryPoint",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "initialMinGas",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "toleranceDelta",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasAllowance",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IEntryPointSimulations.BinarySearchResult",
        "components": [
          {
            "name": "resultType",
            "type": "uint8",
            "internalType": "enum IEntryPointSimulations.BinarySearchResultType"
          },
          {
            "name": "successData",
            "type": "tuple",
            "internalType": "struct IEntryPointSimulations.BinarySearchSuccess",
            "components": [
              {
                "name": "gasUsed",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "success",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "returnData",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          },
          {
            "name": "outOfGasData",
            "type": "tuple",
            "internalType": "struct IEntryPointSimulations.BinarySearchOutOfGas",
            "components": [
              {
                "name": "optimalGas",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "minGas",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "maxGas",
                "type": "uint256",
                "internalType": "uint256"
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
    "name": "binarySearchPaymasterVerificationGas",
    "inputs": [
      {
        "name": "queuedUserOps",
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
        "name": "targetUserOp",
        "type": "tuple",
        "internalType": "struct PackedUserOperation",
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
        "name": "entryPoint",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "initialMinGas",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "toleranceDelta",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasAllowance",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IEntryPointSimulations.BinarySearchResult",
        "components": [
          {
            "name": "resultType",
            "type": "uint8",
            "internalType": "enum IEntryPointSimulations.BinarySearchResultType"
          },
          {
            "name": "successData",
            "type": "tuple",
            "internalType": "struct IEntryPointSimulations.BinarySearchSuccess",
            "components": [
              {
                "name": "gasUsed",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "success",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "returnData",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          },
          {
            "name": "outOfGasData",
            "type": "tuple",
            "internalType": "struct IEntryPointSimulations.BinarySearchOutOfGas",
            "components": [
              {
                "name": "optimalGas",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "minGas",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "maxGas",
                "type": "uint256",
                "internalType": "uint256"
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
    "name": "binarySearchVerificationGas",
    "inputs": [
      {
        "name": "queuedUserOps",
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
        "name": "targetUserOp",
        "type": "tuple",
        "internalType": "struct PackedUserOperation",
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
        "name": "entryPoint",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "initialMinGas",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "toleranceDelta",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasAllowance",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IEntryPointSimulations.BinarySearchResult",
        "components": [
          {
            "name": "resultType",
            "type": "uint8",
            "internalType": "enum IEntryPointSimulations.BinarySearchResultType"
          },
          {
            "name": "successData",
            "type": "tuple",
            "internalType": "struct IEntryPointSimulations.BinarySearchSuccess",
            "components": [
              {
                "name": "gasUsed",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "success",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "returnData",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          },
          {
            "name": "outOfGasData",
            "type": "tuple",
            "internalType": "struct IEntryPointSimulations.BinarySearchOutOfGas",
            "components": [
              {
                "name": "optimalGas",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "minGas",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "maxGas",
                "type": "uint256",
                "internalType": "uint256"
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
    "name": "simulateHandleOp",
    "inputs": [
      {
        "name": "queuedUserOps",
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
        "name": "targetUserOp",
        "type": "tuple",
        "internalType": "struct PackedUserOperation",
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
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IEntryPointSimulations.ExecutionResult",
        "components": [
          {
            "name": "preOpGas",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "paid",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "accountValidationData",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "paymasterValidationData",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "paymasterVerificationGasLimit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "paymasterPostOpGasLimit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "targetSuccess",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "targetResult",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "simulateValidation",
    "inputs": [
      {
        "name": "queuedUserOps",
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
        "name": "targetUserOp",
        "type": "tuple",
        "internalType": "struct PackedUserOperation",
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
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IEntryPointSimulations.ValidationResult",
        "components": [
          {
            "name": "returnInfo",
            "type": "tuple",
            "internalType": "struct IEntryPoint.ReturnInfo",
            "components": [
              {
                "name": "preOpGas",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "prefund",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "accountValidationData",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "paymasterValidationData",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "paymasterContext",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          },
          {
            "name": "senderInfo",
            "type": "tuple",
            "internalType": "struct IStakeManager.StakeInfo",
            "components": [
              {
                "name": "stake",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "unstakeDelaySec",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "factoryInfo",
            "type": "tuple",
            "internalType": "struct IStakeManager.StakeInfo",
            "components": [
              {
                "name": "stake",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "unstakeDelaySec",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "paymasterInfo",
            "type": "tuple",
            "internalType": "struct IStakeManager.StakeInfo",
            "components": [
              {
                "name": "stake",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "unstakeDelaySec",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "aggregatorInfo",
            "type": "tuple",
            "internalType": "struct IEntryPoint.AggregatorStakeInfo",
            "components": [
              {
                "name": "aggregator",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "stakeInfo",
                "type": "tuple",
                "internalType": "struct IStakeManager.StakeInfo",
                "components": [
                  {
                    "name": "stake",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "unstakeDelaySec",
                    "type": "uint256",
                    "internalType": "uint256"
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  }
] as const
