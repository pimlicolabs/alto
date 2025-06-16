// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "account-abstraction-v7/core/UserOperationLib.sol";
import "account-abstraction-v7/core/Helpers.sol";
import {IPaymaster} from "account-abstraction-v7/interfaces/IPaymaster.sol";
import {IEntryPoint} from "account-abstraction-v7/interfaces/IEntryPoint.sol";

contract TestPaymasterV07 is IPaymaster {
    using UserOperationLib for PackedUserOperation;

    IEntryPoint public immutable entryPoint;

    constructor(IEntryPoint _entryPoint) {
        entryPoint = _entryPoint;
    }

    function deposit() public payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32, /*userOpHash*/
        uint256 /*requiredPreFund*/
    ) public view override returns (bytes memory context, uint256 validationData) {
        // Return false if there are paymasterData bytes (this allows us to test failing conditions).
        if (userOp.paymasterAndData.length > (20 + 16 + 16)) {
            return ("", _packValidationData(true, 0, 0));
        }

        // By default sponsor all userOperations.
        return ("", _packValidationData(false, 0, 0));
    }

    function postOp(PostOpMode, bytes calldata, uint256, uint256) external {}
}
