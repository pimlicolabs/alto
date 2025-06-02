// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IEntryPoint {
    function getSenderAddress(bytes calldata initCode) external;
}

contract GetSenderAddressOffchain {
    constructor(address entryPoint, bytes memory initCode) payable {
        (bool success, bytes memory data) =
            entryPoint.call(abi.encodeWithSelector(IEntryPoint.getSenderAddress.selector, initCode));

        address sender;
        if (!success) {
            if (data.length > 4) {
                assembly {
                    sender := mload(add(data, 36))
                }
                assembly {
                    mstore(0, sender)
                    return(0, 32)
                }
            } else {
                revert("getSenderAddress failed without data");
            }
        } else {
            revert("getSenderAddress did not revert as expected");
        }
    }
}
