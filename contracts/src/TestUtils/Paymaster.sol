// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "account-abstraction/core/BasePaymaster.sol";

/**
 * A paymaster that sponsors all UserOperations.
 */
contract SimplePaymaster is BasePaymaster {
    constructor(IEntryPoint _entryPoint) BasePaymaster(_entryPoint) {}

    function _validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32,
        /*userOpHash*/
        uint256 requiredPreFund
    )
        internal
        pure
        override
        returns (bytes memory context, uint256 validationData)
    {
        (userOp, requiredPreFund);
        return ("", _packValidationData(false, 0, 0));
    }
}
