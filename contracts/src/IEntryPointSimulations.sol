// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {PackedUserOperation} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "account-abstraction-v7/interfaces/IEntryPoint.sol";

interface IEntryPointSimulations {
    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                Gas Estimation Binary Search                */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    enum BinarySearchResultType {
        Success,
        OutOfGas
    }

    struct BinarySearchSuccess {
        uint256 gasUsed;
        bool success;
        bytes returnData;
    }

    struct BinarySearchOutOfGas {
        uint256 optimalGas;
        uint256 minGas;
        uint256 maxGas;
    }

    struct BinarySearchResult {
        BinarySearchResultType resultType;
        BinarySearchSuccess successData;
        BinarySearchOutOfGas outOfGasData;
    }

    function binarySearchVerificationGas(
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        address entryPoint,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (BinarySearchResult memory);

    function binarySearchPaymasterVerificationGas(
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        address entryPoint,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (BinarySearchResult memory);

    function binarySearchCallGas(
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        address entryPoint,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (BinarySearchResult memory);

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                     Simulate Handle Op                     */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    // Return value of simulateHandleOp.
    struct ExecutionResult {
        uint256 preOpGas;
        uint256 paid;
        uint256 accountValidationData;
        uint256 paymasterValidationData;
        uint256 paymasterVerificationGasLimit;
        uint256 paymasterPostOpGasLimit;
        bool targetSuccess;
        bytes targetResult;
    }

    function simulateHandleOp(PackedUserOperation[] calldata queuedUserOps, PackedUserOperation calldata targetUserOp)
        external
        returns (ExecutionResult memory);

    function simulateHandleOpSingle(
        PackedUserOperation calldata targetUserOp,
        address target,
        bytes calldata targetData
    ) external returns (ExecutionResult memory);

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                   Safe Validator Methods                   */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    // Successful result from simulateValidation.
    struct ValidationResult {
        IEntryPoint.ReturnInfo returnInfo;
        IEntryPoint.StakeInfo senderInfo;
        IEntryPoint.StakeInfo factoryInfo;
        IEntryPoint.StakeInfo paymasterInfo;
        IEntryPoint.AggregatorStakeInfo aggregatorInfo;
    }

    function simulateValidation(PackedUserOperation[] calldata queuedUserOps, PackedUserOperation calldata targetUserOp)
        external
        returns (ValidationResult memory);
}
