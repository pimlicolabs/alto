pragma solidity ^0.8.23;

import "./EntryPointSimulations.sol";
import "@account-abstraction/utils/Exec.sol";

contract PimlicoEntryPointSimulations {
    EntryPointSimulations internal eps = new EntryPointSimulations();

    uint256 private constant REVERT_REASON_MAX_LEN = 2048;
    bytes4 private constant selector =
        bytes4(keccak256("delegateAndRevert(address,bytes)"));

    constructor() {}

    function simulateEntryPoint(
        address payable ep,
        bytes[] memory data
    ) public returns (bytes[] memory) {
        bytes[] memory returnDataArray = new bytes[](data.length);

        for (uint i = 0; i < data.length; i++) {
            bytes memory returnData;
            bytes memory callData = abi.encodeWithSelector(
                selector,
                address(eps),
                data[i]
            );
            bool success = Exec.call(ep, 0, callData, gasleft());
            if (!success) {
                returnData = Exec.getReturnData(REVERT_REASON_MAX_LEN);
            }
            returnDataArray[i] = returnData;
        }

        return returnDataArray;
    }
}
