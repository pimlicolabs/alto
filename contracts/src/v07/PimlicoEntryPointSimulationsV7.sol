// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./EntryPointSimulations.sol";
import {UserOperation} from "account-abstraction-v6/interfaces/UserOperation.sol";
import {IEntryPoint as IEntryPoint06} from "account-abstraction-v6/interfaces/IEntryPoint.sol";
import {IEntryPoint as IEntryPoint07} from "account-abstraction-v7/interfaces/IEntryPoint.sol";
import {IEntryPoint as IEntryPoint08} from "account-abstraction-v8/interfaces/IEntryPoint.sol";
import {LibBytes} from "solady/utils/LibBytes.sol";

/// @title PimlicoEntryPointSimulationsV7
/// @author Pimlico (https://github.com/pimlicolabs/alto)
/// @notice An ERC-4337 EntryPoint 0.7 simulation contract
contract PimlicoEntryPointSimulationsV7 {
    using LibBytes for bytes;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                          Types                             */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    struct RejectedUserOp {
        bytes32 userOpHash;
        bytes revertReason;
    }

    struct FilterOpsResult {
        uint256 gasUsed;
        uint256 balanceChange;
        RejectedUserOp[] rejectedUserOps;
    }

    event PimlicoSimulationV7Deployed();

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        Variables                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    // @notice Used for filterOps and filterOpsLegacy
    RejectedUserOp[] rejectedUserOps;
    EntryPointSimulations internal eps = new EntryPointSimulations();

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        Constructor                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    constructor() {
        emit PimlicoSimulationV7Deployed();
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                    Estimation Methods                      */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    function simulateEntryPoint(address payable ep, bytes[] memory data) public returns (bytes[] memory) {
        uint256 REVERT_REASON_MAX_LEN = type(uint256).max;
        bytes[] memory returnDataArray = new bytes[](data.length);

        for (uint256 i = 0; i < data.length; i++) {
            bytes memory returnData;
            bytes memory callData =
                abi.encodeWithSelector(IEntryPoint07.delegateAndRevert.selector, address(eps), data[i]);
            bool success = Exec.call(ep, 0, callData, gasleft());
            if (!success) {
                returnData = Exec.getReturnData(REVERT_REASON_MAX_LEN);
            }
            returnDataArray[i] = returnData;
        }

        return returnDataArray;
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
        // Set up memory variables.
        uint256 gasBefore;
        uint256 gasAfter;
        uint256 balanceBefore;
        uint256 balanceAfter;

        PackedUserOperation[] memory remainingUserOps = userOps;
        rejectedUserOps = new RejectedUserOp[](0); // Clear storage variable.

        // Continue to call handleOps until bundle passes.
        while (remainingUserOps.length > 0) {
            gasBefore = gasleft();
            gasAfter = gasBefore;
            balanceBefore = beneficiary.balance;
            balanceAfter = balanceBefore;

            try entryPoint.handleOps(remainingUserOps, beneficiary) {
                // HandleOps succeeded, record gas and balance changes.
                gasAfter = gasleft();
                balanceAfter = beneficiary.balance;
                break;
            } catch (bytes memory revertReason) {
                // Remove userOp that failed and try again.
                (bytes4 errorSelector, bytes memory args) =
                    (bytes4(revertReason), revertReason.slice(4, revertReason.length));

                // Find opIndex of failing userOp.
                uint256 opIndex;
                if (errorSelector == IEntryPoint07.FailedOp.selector) {
                    (opIndex,) = abi.decode(args, (uint256, string));
                } else if (errorSelector == IEntryPoint07.FailedOpWithRevert.selector) {
                    (opIndex,,) = abi.decode(args, (uint256, string, bytes));
                } else {
                    revert("Unknown handleOps Error Selector");
                }

                // record userOpHash and revert reason.
                bytes32 userOpHash = entryPoint.getUserOpHash(remainingUserOps[opIndex]);
                rejectedUserOps.push(RejectedUserOp({userOpHash: userOpHash, revertReason: revertReason}));

                // remove userOp from bundle and try again.
                PackedUserOperation[] memory newArray = new PackedUserOperation[](remainingUserOps.length - 1);
                for (uint256 i = 0; i < remainingUserOps.length - 1; i++) {
                    newArray[i] = i < opIndex ? remainingUserOps[i] : remainingUserOps[i + 1];
                }
                remainingUserOps = newArray;
            }
        }

        return FilterOpsResult({
            gasUsed: gasBefore - gasAfter,
            balanceChange: balanceAfter - balanceBefore,
            rejectedUserOps: rejectedUserOps
        });
    }

    // @notice Filter ops method for EntryPoint 0.6
    // @dev This method should be called by bundler before sending bundle to EntryPoint.
    function filterOps06(UserOperation[] calldata userOps, address payable beneficiary, IEntryPoint06 entryPoint)
        external
        returns (FilterOpsResult memory)
    {
        // Set up memory variables.
        uint256 gasBefore;
        uint256 gasAfter;
        uint256 balanceBefore;
        uint256 balanceAfter;

        UserOperation[] memory remainingUserOps = userOps;
        rejectedUserOps = new RejectedUserOp[](0); // Clear storage variable.

        // Continue to call handleOps until bundle passes.
        while (remainingUserOps.length > 0) {
            gasBefore = gasleft();
            gasAfter = gasBefore;
            balanceBefore = beneficiary.balance;
            balanceAfter = balanceBefore;

            try entryPoint.handleOps(remainingUserOps, beneficiary) {
                // HandleOps succeeded, record gas and balance changes.
                gasAfter = gasleft();
                balanceAfter = beneficiary.balance;
                break;
            } catch (bytes memory revertReason) {
                // Remove userOp that failed and try again.
                (bytes4 errorSelector, bytes memory args) =
                    (bytes4(revertReason), revertReason.slice(4, revertReason.length));

                // Find opIndex of failing userOp.
                uint256 opIndex;
                if (errorSelector == IEntryPoint07.FailedOp.selector) {
                    (opIndex,) = abi.decode(args, (uint256, string));
                } else if (errorSelector == IEntryPoint07.FailedOpWithRevert.selector) {
                    (opIndex,,) = abi.decode(args, (uint256, string, bytes));
                } else {
                    revert("Unknown handleOps Error Selector");
                }

                // record userOpHash and revert reason.
                bytes32 userOpHash = entryPoint.getUserOpHash(remainingUserOps[opIndex]);
                rejectedUserOps.push(RejectedUserOp({userOpHash: userOpHash, revertReason: revertReason}));

                // remove userOp from bundle and try again.
                UserOperation[] memory newArray = new UserOperation[](remainingUserOps.length - 1);
                for (uint256 i = 0; i < remainingUserOps.length - 1; i++) {
                    newArray[i] = i < opIndex ? remainingUserOps[i] : remainingUserOps[i + 1];
                }
                remainingUserOps = newArray;
            }
        }

        return FilterOpsResult({
            gasUsed: gasBefore - gasAfter,
            balanceChange: balanceAfter - balanceBefore,
            rejectedUserOps: rejectedUserOps
        });
    }
}
