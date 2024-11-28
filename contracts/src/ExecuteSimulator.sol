// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "account-abstraction-v6/core/EntryPoint.sol";

contract ExecuteSimulator is EntryPoint {
    error CallExecuteResult(bool success, bytes data, uint256 gasUsed);

    function callExecute(address sender, bytes calldata callData, uint256 gas) external {
        require(msg.sender == 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789);
        uint256 initialGas = gasleft();
        (bool success, bytes memory returnData) = sender.call{gas: gas}(callData);
        uint256 gasUsed = initialGas - gasleft();
        bytes memory data = success ? bytes("") : returnData;
        revert CallExecuteResult(success, data, gasUsed);
    }
}
