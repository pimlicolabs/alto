// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.8;

import "./IInflator.sol";
import { LibZip } from "../lib/solady/src/utils/LibZip.sol";

/// Inflates a bundle containing n ops, each with their own inflator specified.
contract PerOpInflator is IInflator {
    function inflate(
        bytes calldata compressed
    ) external pure override returns (UserOperation[] memory, address payable) {
        UserOperation[] memory ops = abi.decode(LibZip.flzDecompress(compressed), (UserOperation[]));
        return (ops, payable(0x0000000000000000000000000000000000000000));
    }

    function compress(
        UserOperation[] memory ops
    ) external pure returns (bytes memory compressed) {
        compressed = LibZip.flzCompress(abi.encode(ops));
    }
}
