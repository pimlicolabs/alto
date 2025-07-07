// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "solady/tokens/ERC20.sol";
import {UserOperation} from "@account-abstraction-v6/interfaces/UserOperation.sol";
import {IPaymaster} from "@account-abstraction-v6/interfaces/IPaymaster.sol";
import {IEntryPoint} from "@account-abstraction-v6/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {IPaymaster as IPaymasterV7} from "@account-abstraction-v7/interfaces/IPaymaster.sol";
import {IEntryPoint as IEntryPointV7} from "@account-abstraction-v7/interfaces/IEntryPoint.sol";

/// @notice A basic ERC20 paymaster for v0.6 that accepts token payments
contract BasicERC20PaymasterV6 is IPaymaster {
    IEntryPoint public immutable entryPoint;

    constructor(IEntryPoint _entryPoint) {
        entryPoint = _entryPoint;
    }

    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32, uint256)
        external
        pure
        returns (bytes memory context, uint256 validationData)
    {
        // Decode paymaster data: token address, treasury address, and amount
        (address token, address treasury, uint256 amount) =
            abi.decode(userOp.paymasterAndData[20:], (address, address, uint256));

        // Return context with token, treasury, amount, and sender for postOp
        context = abi.encode(token, treasury, amount, userOp.sender);
        validationData = 0; // Always valid
    }

    function postOp(PostOpMode, bytes calldata context, uint256) external {
        // Decode context
        (address token, address treasury, uint256 amount, address sender) =
            abi.decode(context, (address, address, uint256, address));

        // Transfer tokens from user to treasury in postOp
        ERC20(token).transferFrom(sender, treasury, amount);
    }

    receive() external payable {}
}

/// @notice A basic ERC20 paymaster for v0.7 that accepts token payments
contract BasicERC20PaymasterV7 is IPaymasterV7 {
    IEntryPointV7 public immutable entryPoint;

    constructor(IEntryPointV7 _entryPoint) {
        entryPoint = _entryPoint;
    }

    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256)
        external
        pure
        returns (bytes memory context, uint256 validationData)
    {
        // Decode paymaster data: token address, treasury address, and amount
        (address token, address treasury, uint256 amount) =
            abi.decode(userOp.paymasterAndData[20:], (address, address, uint256));

        // Return context with token, treasury, amount, and sender for postOp
        context = abi.encode(token, treasury, amount, userOp.sender);
        validationData = 0; // Always valid
    }

    function postOp(PostOpMode, bytes calldata context, uint256, uint256) external {
        // Decode context
        (address token, address treasury, uint256 amount, address sender) =
            abi.decode(context, (address, address, uint256, address));

        // Transfer tokens from user to treasury in postOp
        ERC20(token).transferFrom(sender, treasury, amount);
    }

    receive() external payable {}
}
