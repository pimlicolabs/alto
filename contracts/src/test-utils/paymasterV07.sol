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
        // paymasterAndData format in v0.7:
        // [paymaster address (20 bytes)][paymasterVerificationGasLimit (16 bytes)][paymasterPostOpGasLimit (16 bytes)][paymasterData (variable)]
        // paymasterData contains: abi.encoded(validUntil, validAfter, invalidSignature, forceRevert)

        bytes calldata paymasterData = userOp.paymasterAndData[52:];

        (uint48 validUntil, uint48 validAfter, bool isValidSignature, bool forceRevert) =
            abi.decode(paymasterData, (uint48, uint48, bool, bool));

        if (forceRevert) {
            revert("Paymaster forced revert");
        }

        return ("", _packValidationData(isValidSignature, validUntil, validAfter));
    }

    function postOp(PostOpMode, bytes calldata, uint256, uint256) external {}
}
