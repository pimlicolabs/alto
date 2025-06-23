// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {PackedUserOperation} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "account-abstraction-v7/interfaces/IEntryPoint.sol";

interface IEntryPointSimulations {
    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                Gas Estimation Binary Search                */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    struct BinarySearchResult {
        uint256 gasUsed;
        bool success;
        bytes returnData;
    }

    function findOptimalVerificationGasLimit(
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        address entryPoint,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (BinarySearchResult memory);

    function findOptimalPaymasterVerificationGasLimit(
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        address entryPoint,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (BinarySearchResult memory);

    function findOptimalCallGasLimit(
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

    function simulateHandleOp(PackedUserOperation calldata op, address target, bytes memory targetCallData)
        external
        returns (ExecutionResult memory);

    function simulateHandleOp(PackedUserOperation[] calldata queuedUserOps, PackedUserOperation calldata targetUserOp)
        external
        returns (ExecutionResult memory);

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                   Safe Validator Methods                   */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * Successful result from simulateValidation.
     * If the account returns a signature aggregator the "aggregatorInfo" struct is filled in as well.
     * @param returnInfo     Gas and time-range returned values
     * @param senderInfo     Stake information about the sender
     * @param factoryInfo    Stake information about the factory (if any)
     * @param paymasterInfo  Stake information about the paymaster (if any)
     * @param aggregatorInfo Signature aggregation info (if the account requires signature aggregator)
     *                       Bundler MUST use it to verify the signature, or reject the UserOperation.
     */
    struct ValidationResult {
        IEntryPoint.ReturnInfo returnInfo;
        IEntryPoint.StakeInfo senderInfo;
        IEntryPoint.StakeInfo factoryInfo;
        IEntryPoint.StakeInfo paymasterInfo;
        IEntryPoint.AggregatorStakeInfo aggregatorInfo;
    }

    function simulateValidation(PackedUserOperation calldata userOp) external returns (ValidationResult memory);

    function simulateValidation(PackedUserOperation[] calldata queuedUserOps, PackedUserOperation calldata targetUserOp)
        external
        returns (ValidationResult memory);
}
