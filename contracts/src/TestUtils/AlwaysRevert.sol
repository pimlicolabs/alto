// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

// @dev Contract to test how bundler handles onchain reverts
contract AlwaysRevert {
    function revertWithMessage(string memory message) public pure {
        revert(message);
    }
}
