// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IEntryPointFilterOpsOverride08 {
    // Must be called once before simulation.
    function initDomainSeparator() external;
}
