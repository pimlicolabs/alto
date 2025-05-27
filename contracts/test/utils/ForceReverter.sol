// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract ForceReverter {
    error RevertWithMsg(string);

    function forceRevertWithMessage(string calldata message) external pure {
        revert RevertWithMsg(message);
    }
}
