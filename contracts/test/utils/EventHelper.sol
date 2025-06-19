// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract EventHelper {
    event MessageEmitted(string message);
    event MessageWithIndexEmitted(string indexed message);
    event MessageWithSenderEmitted(string message, uint256 value, address sender);

    function emitMessage(string memory message) external {
        emit MessageEmitted(message);
    }

    function emitIndexedMessage(string memory message) external {
        emit MessageWithIndexEmitted(message);
    }

    function emitMultipleData(string memory message, uint256 value) external {
        emit MessageWithSenderEmitted(message, value, msg.sender);
    }

    function emitMultipleMessages(string[] memory messages) external {
        for (uint256 i = 0; i < messages.length; i++) {
            emit MessageEmitted(messages[i]);
        }
    }
}