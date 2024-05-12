// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.8;
pragma abicoder v2;

import "bulk/src/IOpInflator.sol";
import {LibZip} from "solady/src/utils/LibZip.sol";

contract SimpleInflator is IOpInflator {
    function inflate(bytes calldata compressed) external pure override returns (UserOperation memory op) {
        op = abi.decode(LibZip.flzDecompress(compressed), (UserOperation));
    }

    function compress(UserOperation memory op) external pure returns (bytes memory compressed) {
        compressed = LibZip.flzCompress(abi.encode(op));
    }
}
