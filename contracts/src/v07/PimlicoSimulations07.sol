// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./EntryPointSimulations.sol";
import {UserOperation} from "account-abstraction-v6/interfaces/UserOperation.sol";
import {IEntryPoint as IEntryPoint06} from "account-abstraction-v6/interfaces/IEntryPoint.sol";
import {IEntryPoint as IEntryPoint07} from "account-abstraction-v7/interfaces/IEntryPoint.sol";
import {Bytes} from "@openzeppelin/contracts-51/utils/Bytes.sol";

/// @title PimlicoSimulations07
/// @author Pimlico (https://github.com/pimlicolabs/alto)
/// @notice An ERC-4337 EntryPoint 0.7 simulation contract for gas estimation and userOperation filtering
contract PimlicoSimulations07 {
    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                          Types                             */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    using Bytes for bytes;

    struct RejectedUserOp {
        bytes32 userOpHash;
        bytes revertReason;
    }

    struct FilterOpsResult {
        uint256 gasUsed;
        uint256 balanceChange;
        RejectedUserOp[] rejectedUserOps;
    }

    event PimlicoSimulations07Deployed();

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        Variables                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    EntryPointSimulations internal eps = new EntryPointSimulations();

    uint256 private constant REVERT_REASON_MAX_LEN = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    bytes4 private constant selector = bytes4(keccak256("delegateAndRevert(address,bytes)"));

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        Constructor                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    constructor() {
        emit PimlicoSimulations07Deployed();
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                          Methods                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    function simulateEntryPoint(address payable ep, bytes[] memory data) public returns (bytes[] memory) {
        bytes[] memory returnDataArray = new bytes[](data.length);

        for (uint256 i = 0; i < data.length; i++) {
            bytes memory returnData;
            bytes memory callData = abi.encodeWithSelector(selector, address(eps), data[i]);
            bool success = Exec.call(ep, 0, callData, gasleft());
            if (!success) {
                returnData = Exec.getReturnData(REVERT_REASON_MAX_LEN);
            }
            returnDataArray[i] = returnData;
        }

        return returnDataArray;
    }

    // @notice Filter ops method for EntryPoint >= 0.7
    // @dev This method should be called by bundler sending bundle to EntryPoint.
    function filterOps(PackedUserOperation[] calldata userOps, address payable beneficiary, IEntryPoint07 entryPoint)
        external
        returns (FilterOpsResult memory)
    {
        // Set up variables for tracking gas and balance changes
        uint256 gasBefore;
        uint256 gasAfter;
        uint256 balanceBefore;
        uint256 balanceAfter;

        // Track remaining userOps to be handled
        PackedUserOperation[] memory remainingUserOps = new PackedUserOperation[](0);
        RejectedUserOp[] memory rejectedUserOps = new RejectedUserOp[](0);

        // Continue to call handleOps until all userOps are
        while (remainingUserOps.length > 0) {
            gasBefore = gasleft();
            balanceBefore = beneficiary.balance;

            try entryPoint.handleOps(remainingUserOps, beneficiary) {
                // HandleOps succeeded, update gas and balance
                gasAfter = gasleft();
                balanceAfter = beneficiary.balance;
                break;
            } catch (bytes memory revertReason) {
                bytes4 errorSelector = bytes4(revertReason);
                bytes memory args;

                if (errorSelector == IEntryPoint07.FailedOp.selector) {
                    bytes memory encodedArgs = revertReason.slice(4, revertReason.length - 4);
                    (uint256 opIndex, string memory reason) = abi.decode(args, (uint256, string));
                    revert("todo");
                } else if (errorSelector == IEntryPoint07.FailedOpWithRevert.selector) {
                    revert("todo");
                } else {
                    revert("todo");
                }
            }
        }

        return FilterOpsResult({
            gasUsed: gasBefore - gasAfter,
            balanceChange: balanceAfter - balanceBefore,
            rejectedUserOps: rejectedUserOps
        });
    }

    // Filter ops method for legacy EntryPoint (0.6)
    //function filterOpsLegacy(UserOperation[] calldata userOps, address payable beneficiary, IEntryPoint06 entryPoint)
    //    external
    //    returns (FilterOpsResult memory)
    //{
    //    revert("todo");
    //    //uint256 gasBefore = gasleft();
    //    //uint256 balanceBefore = beneficiary.balance;

    //    //entryPoint.handleOps(userOps, beneficiary);

    //    //uint256 gasAfter = gasleft();
    //    //uint256 balanceAfter = beneficiary.balance;

    //    //return FilterOpsResult({
    //    //    gasUsed: gasBefore - gasAfter,
    //    //    balanceChange: int256(balanceAfter) - int256(balanceBefore),
    //    //    rejectedUserOpHashes: new bytes32[](0)
    //    //});
    //}
}
