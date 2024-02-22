pragma solidity ^0.8.23;

import "./EntryPointSimulations.sol";

contract PimlicoEntryPointSimulations {
    EntryPointSimulations internal eps = new EntryPointSimulations();

    constructor (address payable ep, bytes memory data) {
        EntryPoint(ep).delegateAndRevert(address(eps), data);
    }
}