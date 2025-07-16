// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin-v4.8.3/contracts/utils/StorageSlot.sol";

// Helper library for common storage slot overrides used across EntryPoint contracts
library SimulationOverrideHelper {
    // Storage slot keys
    bytes32 private constant SENDER_CREATOR_SLOT = keccak256("SENDER_CREATOR");
    bytes32 private constant BLOCK_BASE_FEE_PER_GAS_SLOT = keccak256("BLOCK_BASE_FEE_PER_GAS");
    bytes32 private constant BLOCK_TIMESTAMP_SLOT = keccak256("BLOCK_TIMESTAMP");

    // Default sender creator addresses for each version (set defaults for chains with no StateOverride support)
    address private constant DEFAULT_SENDER_CREATOR_06 = 0x7fc98430eAEdbb6070B35B39D798725049088348;
    address private constant DEFAULT_SENDER_CREATOR_07 = 0xEFC2c1444eBCC4Db75e7613d20C6a62fF67A167C;
    address private constant DEFAULT_SENDER_CREATOR_08 = 0x449ED7C3e6Fee6a97311d4b55475DF59C44AdD33;

    // Get the sender creator address for EntryPoint 0.6
    function getSenderCreator06() internal view returns (address) {
        address creator = StorageSlot.getAddressSlot(SENDER_CREATOR_SLOT).value;
        return creator == address(0) ? DEFAULT_SENDER_CREATOR_06 : creator;
    }

    // Get the sender creator address for EntryPoint 0.7
    function getSenderCreator07() internal view returns (address) {
        address creator = StorageSlot.getAddressSlot(SENDER_CREATOR_SLOT).value;
        return creator == address(0) ? DEFAULT_SENDER_CREATOR_07 : creator;
    }

    // Get the sender creator address for EntryPoint 0.8
    function getSenderCreator08() internal view returns (address) {
        address creator = StorageSlot.getAddressSlot(SENDER_CREATOR_SLOT).value;
        return creator == address(0) ? DEFAULT_SENDER_CREATOR_08 : creator;
    }

    // Get the effective block base fee per gas
    // Returns the overridden value if set, otherwise returns block.basefee
    function getBlockBaseFee() internal view returns (uint256) {
        uint256 baseFee = StorageSlot.getUint256Slot(BLOCK_BASE_FEE_PER_GAS_SLOT).value;
        return baseFee == 0 ? block.basefee : baseFee;
    }

    // Get the effective block timestamp
    // Returns the overridden value if set, otherwise returns block.timestamp
    function getBlockTimestamp() internal view returns (uint256) {
        uint256 timestamp = StorageSlot.getUint256Slot(BLOCK_TIMESTAMP_SLOT).value;
        return timestamp == 0 ? block.timestamp : timestamp;
    }
}
