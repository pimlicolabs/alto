// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract EventHelper {
    event MessageEmitted(string message);
    event MessageWithSenderEmitted(string message, uint256 value, address sender);

    function emitMessage(string memory message) external {
        emit MessageEmitted(message);
    }

    function emitMultipleData(string memory message, uint256 value) external {
        emit MessageWithSenderEmitted(message, value, msg.sender);
    }
}