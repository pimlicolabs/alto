// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IEntryPointSimulations} from "./IEntryPointSimulations.sol";

import {PackedUserOperation} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {UserOperation} from "account-abstraction-v6/interfaces/UserOperation.sol";

import {IEntryPoint as IEntryPoint06} from "account-abstraction-v6/interfaces/IEntryPoint.sol";
import {IEntryPoint as IEntryPoint07} from "account-abstraction-v7/interfaces/IEntryPoint.sol";
import {IEntryPoint as IEntryPoint08} from "account-abstraction-v8/interfaces/IEntryPoint.sol";

import {Exec} from "account-abstraction-v7/utils/Exec.sol";
import {LibBytes} from "solady/utils/LibBytes.sol";
import {console} from "forge-std/console.sol";

/// @title PimlicoSimulations
/// @author Pimlico (https://github.com/pimlicolabs/alto)
/// @notice An ERC-4337 EntryPoint simulation contract
contract PimlicoSimulations {
    using LibBytes for bytes;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                          Types                             */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    // Return type for filterOps.
    struct RejectedUserOp {
        bytes32 userOpHash;
        bytes revertReason;
    }

    // Return type for filterOps.
    struct FilterOpsResult {
        uint256 gasUsed;
        uint256 balanceChange;
        RejectedUserOp[] rejectedUserOps;
    }

    // Return type for verifcation ans estimation.
    struct SimulateAndEstimateGasResult {
        IEntryPointSimulations.ExecutionResult simulationResult;
        IEntryPointSimulations.BinarySearchResult verificationGasLimit;
        IEntryPointSimulations.BinarySearchResult paymasterVerificationGasLimit;
    }

    event PimlicoSimulationDeployed();

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        Variables                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    // @notice Used for filterOps, we use a in storage array so that we can use push().
    RejectedUserOp[] rejectedUserOps;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        Constructor                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    constructor() {
        emit PimlicoSimulationDeployed();
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                    Estimation Methods                      */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    function simulateEntryPoint(address entryPointSimulation, address entryPoint, bytes memory data)
        private
        returns (bytes memory)
    {
        bytes memory returnData;
        bytes4 selector = IEntryPoint07.delegateAndRevert.selector;
        bytes memory callData = abi.encodeWithSelector(selector, entryPointSimulation, data);
        bool success = Exec.call(entryPoint, 0, callData, gasleft());

        if (!success) {
            returnData = Exec.getReturnData(type(uint256).max);
        }

        // Check if we have at least 4 bytes for the selector.
        if (returnData.length < 4) {
            revert("Return data too short");
        }

        // Extract the 4-byte selector using slice.
        bytes4 revertIdentifier = bytes4(returnData.slice(0, 4));
        if (revertIdentifier == IEntryPoint07.delegateAndRevert.selector) {
            revert("Did not revert as expected");
        }

        // Extract the revert data using slice.
        bytes memory revertData = returnData.slice(4, returnData.length);
        (bool delegateAndRevertSuccess, bytes memory delegateAndRevertData) = abi.decode(revertData, (bool, bytes));

        if (!delegateAndRevertSuccess) {
            Exec.revertWithData(delegateAndRevertData);
        }

        return delegateAndRevertData;
    }

    /// @notice Simulates userOp and estimates verification & paymaster gas limits
    function simulateAndEstimateGas(
        address entryPointSimulation,
        address payable entryPoint,
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (SimulateAndEstimateGasResult memory result) {
        // Step 1: Simulate the operation to ensure it's valid
        bytes4 selector = IEntryPointSimulations.simulateHandleOp.selector;
        bytes memory data = abi.encodeWithSelector(selector, queuedUserOps, targetUserOp);
        bytes memory returnData = simulateEntryPoint(entryPointSimulation, entryPoint, data);
        result.simulationResult = abi.decode(returnData, (IEntryPointSimulations.ExecutionResult));

        // If simulation failed, return early with just the simulation result
        if (!result.simulationResult.targetSuccess) {
            return result;
        }

        // Step 2: Find optimal verification gas limit
        result.verificationGasLimit = this.binarySearchVerificationGas(
            entryPointSimulation, entryPoint, queuedUserOps, targetUserOp, initialMinGas, toleranceDelta, gasAllowance
        );

        // Step 3: If paymaster is present, find optimal paymaster verification gas limit
        if (targetUserOp.paymasterAndData.length >= 20) {
            result.paymasterVerificationGasLimit = this.binarySearchPaymasterVerificationGas(
                entryPointSimulation,
                entryPoint,
                queuedUserOps,
                targetUserOp,
                initialMinGas,
                toleranceDelta,
                gasAllowance
            );
        }
    }

    /// @notice Binary search for optimal verification gas limit
    function binarySearchVerificationGas(
        address entryPointSimulation,
        address payable entryPoint,
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (IEntryPointSimulations.BinarySearchResult memory) {
        bytes4 selector = IEntryPointSimulations.binarySearchVerificationGas.selector;
        bytes memory data = abi.encodeWithSelector(
            selector, queuedUserOps, targetUserOp, entryPoint, initialMinGas, toleranceDelta, gasAllowance
        );
        bytes memory returnData = simulateEntryPoint(entryPointSimulation, entryPoint, data);
        return abi.decode(returnData, (IEntryPointSimulations.BinarySearchResult));
    }

    /// @notice Binary search for optimal paymaster verification gas limit
    function binarySearchPaymasterVerificationGas(
        address entryPointSimulation,
        address payable entryPoint,
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (IEntryPointSimulations.BinarySearchResult memory) {
        bytes4 selector = IEntryPointSimulations.binarySearchPaymasterVerificationGas.selector;
        bytes memory data = abi.encodeWithSelector(
            selector, queuedUserOps, targetUserOp, entryPoint, initialMinGas, toleranceDelta, gasAllowance
        );
        bytes memory returnData = simulateEntryPoint(entryPointSimulation, entryPoint, data);
        return abi.decode(returnData, (IEntryPointSimulations.BinarySearchResult));
    }

    /// @notice Binary search for optimal call gas limit
    function binarySearchCallGas(
        address entryPointSimulation,
        address entryPoint,
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (IEntryPointSimulations.BinarySearchResult memory) {
        bytes4 selector = IEntryPointSimulations.binarySearchCallGas.selector;
        bytes memory data = abi.encodeWithSelector(
            selector, queuedUserOps, targetUserOp, entryPoint, initialMinGas, toleranceDelta, gasAllowance
        );
        bytes memory returnData = simulateEntryPoint(entryPointSimulation, entryPoint, data);
        return abi.decode(returnData, (IEntryPointSimulations.BinarySearchResult));
    }

    /// @notice Simulates validation of a UserOperation
    function simulateValidation(
        address entryPointSimulation,
        address payable entryPoint,
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp
    ) external returns (IEntryPointSimulations.ValidationResult memory) {
        bytes4 selector = IEntryPointSimulations.simulateValidation.selector;
        bytes memory data = abi.encodeWithSelector(selector, queuedUserOps, targetUserOp);
        bytes memory returnData = simulateEntryPoint(entryPointSimulation, entryPoint, data);
        return abi.decode(returnData, (IEntryPointSimulations.ValidationResult));
    }

    /// @notice Simulates handling of a UserOperation
    function simulateHandleOp(
        address entryPointSimulation,
        address payable entryPoint,
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp
    ) external returns (IEntryPointSimulations.ExecutionResult memory) {
        bytes4 selector = IEntryPointSimulations.simulateHandleOp.selector;
        bytes memory data = abi.encodeWithSelector(selector, queuedUserOps, targetUserOp);
        bytes memory returnData = simulateEntryPoint(entryPointSimulation, entryPoint, data);
        return abi.decode(returnData, (IEntryPointSimulations.ExecutionResult));
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                     Validation Methods                     */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    // @notice Filter ops method for EntryPoint 0.8
    // @dev This method should be called by bundler before sending bundle to EntryPoint.
    function filterOps08(PackedUserOperation[] calldata userOps, address payable beneficiary, IEntryPoint08 entryPoint)
        external
        returns (FilterOpsResult memory)
    {
        return this.filterOps07(userOps, beneficiary, IEntryPoint07(address(entryPoint)));
    }

    // @notice Filter ops method for EntryPoint 0.7
    // @dev This method should be called by bundler before sending bundle to EntryPoint.
    function filterOps07(PackedUserOperation[] calldata userOps, address payable beneficiary, IEntryPoint07 entryPoint)
        external
        returns (FilterOpsResult memory)
    {
        // Clear storage variable.
        rejectedUserOps = new RejectedUserOp[](0);

        // Set up memory variables.
        uint256 totalGasUsed = 0;
        uint256 totalBalanceChange = 0;

        // Process each UserOperation individually for O(n) complexity
        for (uint256 i = 0; i < userOps.length; i++) {
            // Create a single-element array for the current UserOperation
            PackedUserOperation[] memory singleOpArray = new PackedUserOperation[](1);
            singleOpArray[0] = userOps[i];

            uint256 balanceBefore = beneficiary.balance;
            uint256 gasBefore = gasleft();

            try entryPoint.handleOps(singleOpArray, beneficiary) {
                uint256 gasAfter = gasleft();
                uint256 balanceAfter = beneficiary.balance;

                // Accumulate gas used and balance changes
                totalGasUsed += gasBefore - gasAfter;
                totalBalanceChange += balanceAfter - balanceBefore;
            } catch (bytes memory revertReason) {
                // This UserOperation failed, add it to rejected list
                bytes32 userOpHash = entryPoint.getUserOpHash(userOps[i]);
                rejectedUserOps.push(RejectedUserOp({userOpHash: userOpHash, revertReason: revertReason}));
            }
        }

        return FilterOpsResult({
            gasUsed: totalGasUsed,
            balanceChange: totalBalanceChange,
            rejectedUserOps: rejectedUserOps
        });
    }

    // @notice Filter ops method for EntryPoint 0.6
    // @dev This method should be called by bundler before sending bundle to EntryPoint.
    function filterOps06(UserOperation[] calldata userOps, address payable beneficiary, IEntryPoint06 entryPoint)
        external
        returns (FilterOpsResult memory)
    {
        // Clear storage variable.
        rejectedUserOps = new RejectedUserOp[](0);

        // Set up memory variables.
        uint256 totalGasUsed = 0;
        uint256 totalBalanceChange = 0;

        // Process each UserOperation individually for O(n) complexity
        for (uint256 i = 0; i < userOps.length; i++) {
            // Create a single-element array for the current UserOperation
            UserOperation[] memory singleOpArray = new UserOperation[](1);
            singleOpArray[0] = userOps[i];

            uint256 balanceBefore = beneficiary.balance;
            uint256 gasBefore = gasleft();

            try entryPoint.handleOps(singleOpArray, beneficiary) {
                uint256 gasAfter = gasleft();
                uint256 balanceAfter = beneficiary.balance;

                // Accumulate gas used and balance changes
                totalGasUsed += gasBefore - gasAfter;
                totalBalanceChange += balanceAfter - balanceBefore;
            } catch (bytes memory revertReason) {
                // This UserOperation failed, add it to rejected list
                bytes32 userOpHash = entryPoint.getUserOpHash(userOps[i]);
                rejectedUserOps.push(RejectedUserOp({userOpHash: userOpHash, revertReason: revertReason}));
            }
        }

        return FilterOpsResult({
            gasUsed: totalGasUsed,
            balanceChange: totalBalanceChange,
            rejectedUserOps: rejectedUserOps
        });
    }
}
