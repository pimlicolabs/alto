// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

// Simulation-only contracts, set with eth_call state overrides, that detect a
// userOperation running handleOps on another EntryPoint while it executes. The
// nested userOperations are paid for by their own paymasters and pay a
// beneficiary the sender picks.

// Where the NestedHandleOpsDetector code is set.
// keccak256("alto.nestedHandleOpsDetector")[12:]
address constant NESTED_HANDLE_OPS_DETECTOR = 0x45F0d56b0648D7e01C656aa0cfF11252a10b7fFF;

/// The beneficiary of the simulated handleOps. EntryPoints report handleOps
/// calls to it, and it reverts when the simulated handleOps pays it if one was
/// reported, which reverts the simulated handleOps. Reports are kept in
/// transient storage, which is reverted with the call that wrote it and costs
/// little gas, so recording doesn't make the nested call run out of gas.
contract NestedHandleOpsDetector {
    error NestedHandleOps();

    function recordHandleOps() external {
        assembly {
            tstore(0, 1)
        }
    }

    function handleOpsCalled() public view returns (bool called) {
        assembly {
            called := tload(0)
        }
    }

    receive() external payable {
        if (handleOpsCalled()) {
            revert NestedHandleOps();
        }
    }
}

/// The code of every EntryPoint other than the simulated one. Runs the
/// EntryPoint's real code, copied to getImplementation(address(this)), with
/// delegatecall, so the EntryPoint behaves as onchain. handleOps calls are
/// reported before they run, so a report is reverted along with the call, and
/// is only kept if the nested userOperations would land.
contract EntryPointNestedHandleOpsProxy {
    fallback() external payable {
        bytes4 selector = msg.sig;
        if (
            selector == 0x1fad948c // handleOps v0.6
                || selector == 0x4b1d7cf5 // handleAggregatedOps v0.6
                || selector == 0x765e827f // handleOps v0.7+
                || selector == 0xdbed18e0 // handleAggregatedOps v0.7+
        ) {
            NestedHandleOpsDetector(payable(NESTED_HANDLE_OPS_DETECTOR)).recordHandleOps();
        }

        address implementation = getImplementation(address(this));
        assembly {
            calldatacopy(0, 0, calldatasize())
            let success := delegatecall(gas(), implementation, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(success) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}

function getImplementation(address entryPoint) pure returns (address) {
    return address(uint160(uint256(keccak256(abi.encodePacked("alto.nestedHandleOps.implementation", entryPoint)))));
}
