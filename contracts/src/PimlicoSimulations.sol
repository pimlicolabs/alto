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
import {ERC20} from "solady/tokens/ERC20.sol";

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
    struct VerificationGasLimitsResult {
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

    /// @notice Simulates userOp and estimates verification & paymaster gas limits
    function simulateAndEstimateGasLimits(
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        address payable entryPoint,
        address entryPointSimulation,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (VerificationGasLimitsResult memory result) {
        // Step 1: Simulate the operation to ensure it's valid
        result.simulationResult =
            IEntryPointSimulations(entryPointSimulation).simulateHandleOp(queuedUserOps, targetUserOp);

        // If simulation failed, return early with just the simulation result
        if (!result.simulationResult.targetSuccess) {
            return result;
        }

        // Step 2: Find optimal verification gas limit
        result.verificationGasLimit = IEntryPointSimulations(entryPointSimulation).findOptimalVerificationGasLimit(
            queuedUserOps, targetUserOp, entryPoint, initialMinGas, toleranceDelta, gasAllowance
        );

        // Step 3: If paymaster is present, find optimal paymaster verification gas limit
        if (targetUserOp.paymasterAndData.length >= 20) {
            result.paymasterVerificationGasLimit = IEntryPointSimulations(entryPointSimulation)
                .findOptimalPaymasterVerificationGasLimit(
                queuedUserOps, targetUserOp, entryPoint, initialMinGas, toleranceDelta, gasAllowance
            );
        }
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

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                     ERC-20 Validation                      */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/
    //function validateERC20PostOp(
    //    address entryPointSimulation,
    //    UserOperation calldata userOp,
    //    address erc20,
    //    address payable treasury
    //) external {
    //    uint256 balanceBefore = ERC20(erc20).balanceOf(treasury);
    //    bytes memory callData =
    //        abi.encodeWithSelector(IEntryPoint07.delegateAndRevert.selector, entryPointSimulation, data[i]);
    //    bool success = Exec.call(entryPoint, 0, callData, gasleft());
    //    if (!success) {
    //        returnData = Exec.getReturnData(REVERT_REASON_MAX_LEN);
    //    }
    //}
}
