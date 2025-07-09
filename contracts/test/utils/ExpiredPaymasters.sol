// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {UserOperation as UserOperation06} from "account-abstraction-v6/interfaces/UserOperation.sol";
import {IEntryPoint as IEntryPoint06} from "account-abstraction-v6/interfaces/IEntryPoint.sol";
import {IPaymaster as IPaymaster06} from "account-abstraction-v6/interfaces/IPaymaster.sol";
import {_packValidationData as _packValidationData06} from "account-abstraction-v6/core/Helpers.sol";

import {PackedUserOperation as PackedUserOperation07} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {IEntryPoint as IEntryPoint07} from "account-abstraction-v7/interfaces/IEntryPoint.sol";
import {IPaymaster as IPaymaster07} from "account-abstraction-v7/interfaces/IPaymaster.sol";
import {_packValidationData as _packValidationData07} from "account-abstraction-v7/core/Helpers.sol";

import {PackedUserOperation as PackedUserOperation08} from "account-abstraction-v8/interfaces/PackedUserOperation.sol";
import {IEntryPoint as IEntryPoint08} from "account-abstraction-v8/interfaces/IEntryPoint.sol";
import {IPaymaster as IPaymaster08} from "account-abstraction-v8/interfaces/IPaymaster.sol";
import {_packValidationData as _packValidationData08} from "account-abstraction-v8/core/Helpers.sol";

// Test paymaster that returns expired validUntil for v0.6
contract ExpiredPaymaster06 is IPaymaster06 {
    IEntryPoint06 public immutable entryPoint;

    constructor(IEntryPoint06 _entryPoint) {
        entryPoint = _entryPoint;
    }

    function deposit() public payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function validatePaymasterUserOp(UserOperation06 calldata, bytes32, uint256)
        public
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        // Return expired validUntil (current block timestamp - 1)
        return ("", _packValidationData06(false, uint48(block.timestamp - 1), 0));
    }

    function postOp(IPaymaster06.PostOpMode, bytes calldata, uint256) public override {}
}

// Test paymaster that returns expired validUntil for v0.7
contract ExpiredPaymaster07 is IPaymaster07 {
    IEntryPoint07 public immutable entryPoint;

    constructor(IEntryPoint07 _entryPoint) {
        entryPoint = _entryPoint;
    }

    function deposit() public payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function validatePaymasterUserOp(PackedUserOperation07 calldata, bytes32, uint256)
        public
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        // Return expired validUntil (current block timestamp - 1)
        return ("", _packValidationData07(false, uint48(block.timestamp - 1), 0));
    }

    function postOp(IPaymaster07.PostOpMode, bytes calldata, uint256, uint256) external override {}
}

// Test paymaster that returns expired validUntil for v0.8
contract ExpiredPaymaster08 is IPaymaster08 {
    IEntryPoint08 public immutable entryPoint;

    constructor(IEntryPoint08 _entryPoint) {
        entryPoint = _entryPoint;
    }

    function deposit() public payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function validatePaymasterUserOp(PackedUserOperation08 calldata, bytes32, uint256)
        public
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        // Return expired validUntil (current block timestamp - 1)
        return ("", _packValidationData08(false, uint48(block.timestamp - 1), 0));
    }

    function postOp(IPaymaster08.PostOpMode, bytes calldata, uint256, uint256) external override {}
}
