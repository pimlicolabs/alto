// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import {UserOperation} from "account-abstraction-v6/interfaces/UserOperation.sol";
import {_packValidationData} from "account-abstraction-v6/core/Helpers.sol";
import {IPaymaster} from "account-abstraction-v6/interfaces/IPaymaster.sol";
import {IEntryPoint} from "account-abstraction-v6/interfaces/IEntryPoint.sol";

contract TestPaymasterV06 is IPaymaster {
    IEntryPoint public immutable entryPoint;

    constructor(IEntryPoint _entryPoint) {
        entryPoint = _entryPoint;
    }

    function deposit() public payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32, /*userOpHash*/
        uint256 /*requiredPreFund*/
    ) public pure override returns (bytes memory context, uint256 validationData) {
        // Return false if there are paymasterData bytes (this allows us to test failing conditions).
        if (userOp.paymasterAndData.length > 20) {
            return ("", _packValidationData(true, 0, 0));
        }

        // By default sponsor all userOperations.
        return ("", _packValidationData(false, 0, 0));
    }

    function postOp(PostOpMode, bytes calldata, uint256) public {}
}
