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
        // paymasterAndData format: [paymaster address (20 bytes)][abi.encoded(validUntil, validAfter, invalidSignature, forceRevert)]
        bytes calldata paymasterData = userOp.paymasterAndData[20:];

        (uint48 validUntil, uint48 validAfter, bool isValidSignature, bool forceRevert) =
            abi.decode(paymasterData, (uint48, uint48, bool, bool));

        if (forceRevert) {
            revert("Paymaster forced revert");
        }

        return ("", _packValidationData(isValidSignature, validUntil, validAfter));
    }

    function postOp(PostOpMode, bytes calldata, uint256) public {}
}
