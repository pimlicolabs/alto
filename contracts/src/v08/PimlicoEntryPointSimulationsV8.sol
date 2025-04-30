pragma solidity ^0.8.28;

import "./EntryPointSimulations.sol";
import "account-abstraction-v8/utils/Exec.sol";

contract PimlicoEntryPointSimulationsV8 {
    event PimlicoSimulationV8Deployed();

    EntryPointSimulations internal eps = new EntryPointSimulations();

    uint256 private constant REVERT_REASON_MAX_LEN = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    bytes4 private constant selector = bytes4(keccak256("delegateAndRevert(address,bytes)"));

    constructor() {
        emit PimlicoSimulationV8Deployed();
    }

    function simulateEntryPoint(address payable ep, bytes[] memory data) public returns (bytes[] memory) {
        bytes[] memory returnDataArray = new bytes[](data.length);

        for (uint256 i = 0; i < data.length; i++) {
            bytes memory returnData;
            bytes memory callData = abi.encodeWithSelector(selector, address(eps), data[i]);
            bool success = Exec.call(ep, 0, callData, gasleft());
            if (!success) {
                returnData = Exec.getReturnData(REVERT_REASON_MAX_LEN);
            }
            returnDataArray[i] = returnData;
        }

        return returnDataArray;
    }
}
