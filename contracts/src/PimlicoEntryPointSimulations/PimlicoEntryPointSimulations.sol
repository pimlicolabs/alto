pragma solidity ^0.8.23;

import "./EntryPointSimulations.sol";

contract PimlicoEntryPointSimulations {
    EntryPointSimulations internal eps = new EntryPointSimulations();

    constructor () {}

    function simulateEntryPoint(address payable ep, bytes[] memory data) public returns(bytes[] memory) {
        bytes[] memory returnDataArray = new bytes[](data.length + 1);

        for(uint i = 0; i < data.length; i++) {
            bytes memory returnData;
            try EntryPoint(ep).delegateAndRevert(address(eps), data[i])
            {} catch {
                assembly ("memory-safe") {
                    let len := returndatasize()
                    let ptr := mload(0x40)
                    mstore(0x40, add(ptr, add(len, 0x20)))
                    mstore(ptr, len)
                    returndatacopy(add(ptr, 0x20), 0, len)
                    returnData := ptr
                }
            }
            returnDataArray[i] = returnData;
        }

        return returnDataArray;
    }

}