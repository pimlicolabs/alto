// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./EntryPointSimulations.sol";
import {UserOperation} from "account-abstraction-v6/interfaces/UserOperation.sol";
import {IEntryPoint as IEntryPointV6} from "account-abstraction-v6/interfaces/IEntryPoint.sol";
import {IEntryPoint as IEntryPointV7} from "account-abstraction-v7/interfaces/IEntryPoint.sol";

contract PimlicoEntryPointSimulationsV7 {
    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                          Types                             */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    struct FilterOpsResult {
        uint256 gasUsed;
        int256 balanceChange;
        bytes32[] rejectedUserOpHashes;
    }

    event PimlicoSimulationV7Deployed();

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
        emit PimlicoSimulationV7Deployed();
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

    // Filter ops method for EntryPoint >= 0.7
    function filterOps(PackedUserOperation[] calldata userOps, address payable beneficiary, IEntryPointV7 entryPoint)
        external
        returns (FilterOpsResult memory)
    {
        uint256 gasBefore = gasleft();
        uint256 balanceBefore = beneficiary.balance;

        bytes32[] memory failedUserOpHashes = new bytes32[](0);
        entryPoint.handleOps(userOps, beneficiary);

        uint256 gasAfter = gasleft();
        uint256 balanceAfter = beneficiary.balance;

        return FilterOpsResult({
            gasUsed: gasBefore - gasAfter,
            balanceChange: int256(balanceAfter) - int256(balanceBefore),
            rejectedUserOpHashes: new bytes32[](0)
        });
    }

    // Filter ops method for legacy EntryPoint (0.6)
    function filterOpsLegacy(UserOperation[] calldata userOps, address payable beneficiary, IEntryPointV6 entryPoint)
        external
        returns (FilterOpsResult memory)
    {
        uint256 gasBefore = gasleft();
        uint256 balanceBefore = beneficiary.balance;

        entryPoint.handleOps(userOps, beneficiary);

        uint256 gasAfter = gasleft();
        uint256 balanceAfter = beneficiary.balance;

        return FilterOpsResult({
            gasUsed: gasBefore - gasAfter,
            balanceChange: int256(balanceAfter) - int256(balanceBefore),
            rejectedUserOpHashes: new bytes32[](0)
        });
    }
}
