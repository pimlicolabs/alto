// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/PimlicoSimulations.sol";

import {ForceReverter} from "@test-utils/ForceReverter.sol";
import {UserOpHelper} from "./utils/UserOpHelper.sol";

import {UserOperation as UserOperation06} from "account-abstraction-v6/interfaces/UserOperation.sol";
import {IEntryPoint as IEntryPoint06} from "account-abstraction-v6/interfaces/IEntryPoint.sol";
import {EntryPoint as EntryPoint06} from "@test-aa-utils/v06/core/EntryPoint.sol";
import {SimpleAccountFactory as SimpleAccountFactory06} from "@test-aa-utils/v06/samples/SimpleAccountFactory.sol";
import {SimpleAccount as SimpleAccount06} from "@test-aa-utils/v06/samples/SimpleAccount.sol";

import {PackedUserOperation as PackedUserOperation07} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {IEntryPoint as IEntryPoint07} from "account-abstraction-v7/interfaces/IEntryPoint.sol";
import {EntryPoint as EntryPoint07} from "@test-aa-utils/v07/core/EntryPoint.sol";
import {SimpleAccountFactory as SimpleAccountFactory07} from "@test-aa-utils/v07/samples/SimpleAccountFactory.sol";
import {SimpleAccount as SimpleAccount07} from "@test-aa-utils/v07/samples/SimpleAccount.sol";

import {PackedUserOperation as PackedUserOperation08} from "account-abstraction-v8/interfaces/PackedUserOperation.sol";
import {IEntryPoint as IEntryPoint08} from "account-abstraction-v8/interfaces/IEntryPoint.sol";
import {EntryPoint as EntryPoint08} from "@test-aa-utils/v08/core/EntryPoint.sol";
import {SimpleAccountFactory as SimpleAccountFactory08} from "@test-aa-utils/v08/accounts/SimpleAccountFactory.sol";
import {SimpleAccount as SimpleAccount08} from "@test-aa-utils/v08/accounts/SimpleAccount.sol";

import {ExpiredPaymaster06, ExpiredPaymaster07, ExpiredPaymaster08} from "./utils/ExpiredPaymasters.sol";
import {
    PostOpRevertPaymaster06,
    PostOpRevertPaymaster07,
    PostOpRevertPaymaster08
} from "./utils/PostOpRevertPaymasters.sol";

contract FilterOpsTest is UserOpHelper {
    PimlicoSimulations pimlicoSim;

    address payable beneficiary = payable(address(0x1234));

    address forceReverter;
    ExpiredPaymaster06 expiredPaymaster06;
    ExpiredPaymaster07 expiredPaymaster07;
    ExpiredPaymaster08 expiredPaymaster08;
    PostOpRevertPaymaster06 postOpRevertPaymaster06;
    PostOpRevertPaymaster07 postOpRevertPaymaster07;
    PostOpRevertPaymaster08 postOpRevertPaymaster08;

    function setUp() public {
        // Setup EntryPoints, factories and owner key from UserOpHelper
        setupTestEnvironment("alice");

        // Deploy simulation contracts + helpers.
        pimlicoSim = new PimlicoSimulations();
        forceReverter = address(new ForceReverter());

        // Deploy and fund expired paymasters.
        expiredPaymaster06 = new ExpiredPaymaster06(entryPoint06);
        expiredPaymaster07 = new ExpiredPaymaster07(entryPoint07);
        expiredPaymaster08 = new ExpiredPaymaster08(entryPoint08);

        expiredPaymaster06.deposit{value: 10 ether}();
        expiredPaymaster07.deposit{value: 10 ether}();
        expiredPaymaster08.deposit{value: 10 ether}();

        // Deploy and fund postOp revert paymasters.
        postOpRevertPaymaster06 = new PostOpRevertPaymaster06(entryPoint06);
        postOpRevertPaymaster07 = new PostOpRevertPaymaster07(entryPoint07);
        postOpRevertPaymaster08 = new PostOpRevertPaymaster08(entryPoint08);

        postOpRevertPaymaster06.deposit{value: 10 ether}();
        postOpRevertPaymaster07.deposit{value: 10 ether}();
        postOpRevertPaymaster08.deposit{value: 10 ether}();
    }

    // ============================================
    // =========== ENTRYPOINT 06 TESTS ============
    // ============================================

    // Test filterOps06 with all valid operations
    function testFilterOps06_AllValid() public {
        UserOperation06[] memory ops = new UserOperation06[](3);

        // Simple execute call with no revert - to: address(0), value: 0, data: ""
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        ops[0] = createSignedUserOp06(0, call, "");
        ops[1] = createSignedUserOp06(1, call, "");
        ops[2] = createSignedUserOp06(2, call, "");

        // Fund accounts
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[1].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps06 with one failing operation
    function testFilterOps06_OneFailingOp() public {
        UserOperation06[] memory ops = new UserOperation06[](3);

        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        ops[0] = createSignedUserOp06(0, call, ""); // should pass
        ops[1] = createSignedUserOp06(1, call, ""); // should fail due to insufficient funds
        ops[2] = createSignedUserOp06(2, call, ""); // should pass

        // Fund only the first and last userOps, middle userOp will fail due to insufficient funds
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint06.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint06.FailedOp.selector, 0, "AA21 didn't pay prefund")
        );
    }

    // Test filterOps06 with invalid signature
    function testFilterOps06_InvalidSignature() public {
        UserOperation06[] memory ops = new UserOperation06[](1);

        ops[0] = createSignedUserOp06(0, UserOpHelper.Call({to: address(0), value: 0, data: ""}), "");

        // Fund account
        vm.deal(ops[0].sender, 1 ether);

        // Replace with invalid signature
        ops[0].signature = hex"deadbeef";

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        // Operation should be rejected
        _assertAllFailedResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint06.FailedOp.selector, 0, "AA23 reverted: ECDSA: invalid signature length")
        );
    }

    // Test filterOps06 with all failing operations
    function testFilterOps06_AllFailingOps() public {
        UserOperation06[] memory ops = new UserOperation06[](2);

        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        ops[0] = createSignedUserOp06(0, call, ""); // should fail due to insufficient funds
        ops[1] = createSignedUserOp06(1, call, ""); // should fail due to insufficient funds

        // No funding - both userOps will fail due to insufficient funds

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        _assertAllFailedResult(result, 2);
    }

    // Test filterOps06 with empty array
    function testFilterOps06_EmptyArray() public {
        UserOperation06[] memory ops = new UserOperation06[](0);
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);
        _assertEmptyResult(result);
    }

    // Test filterOps06 with reverting userOp.callData (all ops should be valid)
    function testFilterOps06_OneCallPhaseRevert() public {
        UserOperation06[] memory ops = new UserOperation06[](3);

        // Normal calls for accounts 0 and 2
        UserOpHelper.Call memory normalCall = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        ops[0] = createSignedUserOp06(0, normalCall, "");

        // Account 1 will revert during call phase
        bytes memory revertData = abi.encodeWithSelector(ForceReverter.forceRevertWithMessage.selector, "foobar");
        ops[1] = createSignedUserOp06(1, UserOpHelper.Call({to: forceReverter, value: 0, data: revertData}), "");

        ops[2] = createSignedUserOp06(2, normalCall, "");

        // Fund all accounts
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[1].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);
        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps06 with expired paymaster (AA32 error)
    function testFilterOps06_ExpiredPaymaster() public {
        UserOperation06[] memory ops = new UserOperation06[](3);

        bytes memory revertingPaymasterAndData = abi.encodePacked(address(expiredPaymaster06));
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});

        ops[0] = createSignedUserOp06(0, call, "");
        ops[1] = createSignedUserOp06(1, call, revertingPaymasterAndData);
        ops[2] = createSignedUserOp06(2, call, "");

        // Fund all accounts
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[1].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        // Advance block timestamp to ensure the paymaster validation fails
        vm.warp(block.timestamp + 2);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        // Second operation should be rejected with AA32 error
        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint06.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint06.FailedOp.selector, 0, "AA32 paymaster expired or not due")
        );
    }

    // Test filterOps06 with postOp reverting paymaster (AA50 error)
    function testFilterOps06_PostOpRevertPaymaster() public {
        UserOperation06[] memory ops = new UserOperation06[](3);

        bytes memory revertingPaymasterAndData = abi.encodePacked(address(postOpRevertPaymaster06));
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});

        ops[0] = createSignedUserOp06(0, call, "");
        ops[1] = createSignedUserOp06(1, call, revertingPaymasterAndData);
        ops[2] = createSignedUserOp06(2, call, "");

        // Fund all accounts
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[1].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        // Second operation should be rejected with AA50 error
        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint06.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint06.FailedOp.selector, 0, "AA50 postOp reverted: AA50 postOp reverted")
        );
    }

    // ============================================
    // =========== ENTRYPOINT 07 TESTS ============
    // ============================================

    // Test filterOps07 with all valid operations
    function testFilterOps07_AllValid() public {
        PackedUserOperation07[] memory ops = new PackedUserOperation07[](3);

        // Simple execute call with no revert
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        ops[0] = createSignedUserOp07(0, call, "");
        ops[1] = createSignedUserOp07(1, call, "");
        ops[2] = createSignedUserOp07(2, call, "");

        // Fund all accounts
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[1].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps07 with one failing operation
    function testFilterOps07_OneFailingOp() public {
        PackedUserOperation07[] memory ops = new PackedUserOperation07[](3);

        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        ops[0] = createSignedUserOp07(0, call, ""); // should pass
        ops[1] = createSignedUserOp07(1, call, ""); // should fail due to insufficient funds
        ops[2] = createSignedUserOp07(2, call, ""); // should pass

        // Fund only the first and last userOps, middle userOp will fail due to insufficient funds
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint07.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint07.FailedOp.selector, 0, "AA21 didn't pay prefund")
        );
    }

    // Test filterOps07 with invalid signature
    function testFilterOps07_InvalidSignature() public {
        PackedUserOperation07[] memory ops = new PackedUserOperation07[](1);

        ops[0] = createSignedUserOp07(0, UserOpHelper.Call({to: address(0), value: 0, data: ""}), "");

        // Fund account
        vm.deal(ops[0].sender, 1 ether);

        // Replace with invalid signature
        ops[0].signature = hex"deadbeef";

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        // Operation should be rejected
        _assertAllFailedResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(
                IEntryPoint07.FailedOpWithRevert.selector,
                0,
                "AA23 reverted",
                abi.encodeWithSelector(
                    bytes4(keccak256("ECDSAInvalidSignatureLength(uint256)")), uint256(ops[0].signature.length)
                )
            )
        );
    }

    // Test filterOps07 with all failing operations
    function testFilterOps07_AllFailingOps() public {
        PackedUserOperation07[] memory ops = new PackedUserOperation07[](2);

        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        ops[0] = createSignedUserOp07(0, call, ""); // should fail due to insufficient funds
        ops[1] = createSignedUserOp07(1, call, ""); // should fail due to insufficient funds

        // No funding - both userOps will fail due to insufficient funds

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        _assertAllFailedResult(result, 2);
    }

    // Test filterOps07 with empty array
    function testFilterOps07_EmptyArray() public {
        PackedUserOperation07[] memory ops = new PackedUserOperation07[](0);
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);
        _assertEmptyResult(result);
    }

    // Test filterOps07 with reverting userOp.callData (all ops should be valid)
    function testFilterOps07_OneCallPhaseRevert() public {
        PackedUserOperation07[] memory ops = new PackedUserOperation07[](3);

        // Normal calls for accounts 0 and 2
        UserOpHelper.Call memory normalCall = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        ops[0] = createSignedUserOp07(0, normalCall, "");

        // Account 1 will revert during call phase
        bytes memory revertData = abi.encodeWithSelector(ForceReverter.forceRevertWithMessage.selector, "foobar");
        ops[1] = createSignedUserOp07(1, UserOpHelper.Call({to: forceReverter, value: 0, data: revertData}), "");

        ops[2] = createSignedUserOp07(2, normalCall, "");

        // Fund all accounts
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[1].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);
        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps07 with expired paymaster (AA32 error)
    function testFilterOps07_ExpiredPaymaster() public {
        PackedUserOperation07[] memory ops = new PackedUserOperation07[](3);

        bytes memory revertingPaymasterAndData = abi.encodePacked(
            address(expiredPaymaster07),
            uint128(100000), // paymasterVerificationGasLimit
            uint128(50000) // paymasterPostOpGasLimit
        );
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});

        ops[0] = createSignedUserOp07(0, call, "");
        ops[1] = createSignedUserOp07(1, call, revertingPaymasterAndData);
        ops[2] = createSignedUserOp07(2, call, "");

        // Fund all accounts
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[1].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        // Advance block timestamp to ensure the paymaster validation fails
        vm.warp(block.timestamp + 2);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        // Second operation should be rejected with AA32 error
        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint07.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint07.FailedOp.selector, 0, "AA32 paymaster expired or not due")
        );
    }

    // Test filterOps07 with postOp reverting paymaster (should still succeed in v0.7+)
    function testFilterOps07_PostOpRevertPaymaster() public {
        PackedUserOperation07[] memory ops = new PackedUserOperation07[](3);

        bytes memory revertingPaymasterAndData = abi.encodePacked(
            address(postOpRevertPaymaster07),
            uint128(100000), // paymasterVerificationGasLimit
            uint128(50000) // paymasterPostOpGasLimit
        );
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});

        ops[0] = createSignedUserOp07(0, call, "");
        ops[1] = createSignedUserOp07(1, call, revertingPaymasterAndData);
        ops[2] = createSignedUserOp07(2, call, "");

        // Fund accounts
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[1].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        // In v0.7+, postOp reverts don't cause operation failure - all ops should succeed
        _assertValidOpsResult(result, balanceBefore);
    }

    // ============================================
    // =========== ENTRYPOINT 08 TESTS ============
    // ============================================

    // Test filterOps08 with all valid operations
    function testFilterOps08_AllValid() public {
        PackedUserOperation08[] memory ops = new PackedUserOperation08[](3);

        // Simple execute call with no revert
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        ops[0] = createSignedUserOp08(0, call, "");
        ops[1] = createSignedUserOp08(1, call, "");
        ops[2] = createSignedUserOp08(2, call, "");

        // Fund all accounts
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[1].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps08 with one failing operation
    function testFilterOps08_OneFailingOp() public {
        PackedUserOperation08[] memory ops = new PackedUserOperation08[](3);

        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        ops[0] = createSignedUserOp08(0, call, ""); // should pass
        ops[1] = createSignedUserOp08(1, call, ""); // should fail due to insufficient funds
        ops[2] = createSignedUserOp08(2, call, ""); // should pass

        // Fund only the first and last userOps, middle userOp will fail due to insufficient funds
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint08.getUserOpHash(ops[1]), "Second op should be rejected"
        );
    }

    // Test filterOps08 with invalid signature
    function testFilterOps08_InvalidSignature() public {
        PackedUserOperation08[] memory ops = new PackedUserOperation08[](1);

        ops[0] = createSignedUserOp08(0, UserOpHelper.Call({to: address(0), value: 0, data: ""}), "");

        // Fund account
        vm.deal(ops[0].sender, 1 ether);

        // Replace with invalid signature
        ops[0].signature = hex"deadbeef";

        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        // Operation should be rejected
        _assertAllFailedResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(
                IEntryPoint08.FailedOpWithRevert.selector,
                0,
                "AA23 reverted",
                abi.encodeWithSelector(
                    bytes4(keccak256("ECDSAInvalidSignatureLength(uint256)")), uint256(ops[0].signature.length)
                )
            )
        );
    }

    // Test filterOps08 with all failing operations
    function testFilterOps08_AllFailingOps() public {
        PackedUserOperation08[] memory ops = new PackedUserOperation08[](2);

        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        ops[0] = createSignedUserOp08(0, call, ""); // should fail due to insufficient funds
        ops[1] = createSignedUserOp08(1, call, ""); // should fail due to insufficient funds

        // No funding - both userOps will fail due to insufficient funds

        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        _assertAllFailedResult(result, 2);
    }

    // Test filterOps08 with empty array
    function testFilterOps08_EmptyArray() public {
        PackedUserOperation08[] memory ops = new PackedUserOperation08[](0);
        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);
        _assertEmptyResult(result);
    }

    // Test filterOps08 with reverting userOp.callData (all ops should be valid)
    function testFilterOps08_OneCallPhaseRevert() public {
        PackedUserOperation08[] memory ops = new PackedUserOperation08[](3);

        // Normal calls for accounts 0 and 2
        UserOpHelper.Call memory normalCall = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        ops[0] = createSignedUserOp08(0, normalCall, "");

        // Account 1 will revert during call phase
        bytes memory revertData = abi.encodeWithSelector(ForceReverter.forceRevertWithMessage.selector, "foobar");
        ops[1] = createSignedUserOp08(1, UserOpHelper.Call({to: forceReverter, value: 0, data: revertData}), "");

        ops[2] = createSignedUserOp08(2, normalCall, "");

        // Fund all accounts
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[1].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);
        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps08 with expired paymaster (AA32 error)
    function testFilterOps08_ExpiredPaymaster() public {
        PackedUserOperation08[] memory ops = new PackedUserOperation08[](3);

        bytes memory revertingPaymasterAndData = abi.encodePacked(
            address(expiredPaymaster08),
            uint128(100000), // paymasterVerificationGasLimit
            uint128(50000) // paymasterPostOpGasLimit
        );
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});

        ops[0] = createSignedUserOp08(0, call, "");
        ops[1] = createSignedUserOp08(1, call, revertingPaymasterAndData);
        ops[2] = createSignedUserOp08(2, call, "");

        // Fund all accounts
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[1].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        // Advance block timestamp to ensure the paymaster validation fails
        vm.warp(block.timestamp + 2);

        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        // Second operation should be rejected with AA32 error
        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint08.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint08.FailedOp.selector, 0, "AA32 paymaster expired or not due")
        );
    }

    // Test filterOps08 with postOp reverting paymaster (should still succeed in v0.8)
    function testFilterOps08_PostOpRevertPaymaster() public {
        PackedUserOperation08[] memory ops = new PackedUserOperation08[](3);

        bytes memory revertingPaymasterAndData = abi.encodePacked(
            address(postOpRevertPaymaster08),
            uint128(100000), // paymasterVerificationGasLimit
            uint128(50000) // paymasterPostOpGasLimit
        );
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});

        ops[0] = createSignedUserOp08(0, call, "");
        ops[1] = createSignedUserOp08(1, call, revertingPaymasterAndData);
        ops[2] = createSignedUserOp08(2, call, "");

        // Fund all accounts
        vm.deal(ops[0].sender, 1 ether);
        vm.deal(ops[1].sender, 1 ether);
        vm.deal(ops[2].sender, 1 ether);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        // In v0.8, postOp reverts don't cause operation failure - all ops should succeed
        _assertValidOpsResult(result, balanceBefore);
    }

    // ============================================
    // ============== TEST HELPERS ================
    // ============================================

    function _assertValidOpsResult(PimlicoSimulations.FilterOpsResult memory result, uint256 balanceBefore) private {
        assertEq(result.rejectedUserOps.length, 0, "No operations should be rejected");
        assertGt(result.gasUsed, 0, "Gas should be used");
        assertGt(result.balanceChange, 0, "Balance should increase");
        assertEq(beneficiary.balance - balanceBefore, result.balanceChange, "Balance change should match");
    }

    function _assertPartialFailureResult(PimlicoSimulations.FilterOpsResult memory result, uint256 expectedRejected)
        private
    {
        assertEq(result.rejectedUserOps.length, expectedRejected, "Expected number of operations should be rejected");
        assertGt(result.gasUsed, 0, "Gas should be used");
        assertGt(result.balanceChange, 0, "Balance should increase");
    }

    function _assertAllFailedResult(PimlicoSimulations.FilterOpsResult memory result, uint256 totalOps) private {
        assertEq(result.rejectedUserOps.length, totalOps, "All operations should be rejected");
        assertEq(result.gasUsed, 0, "No gas should be used");
        assertEq(result.balanceChange, 0, "Balance should not change");
    }

    function _assertEmptyResult(PimlicoSimulations.FilterOpsResult memory result) private {
        assertEq(result.rejectedUserOps.length, 0, "No operations should be rejected");
        assertEq(result.gasUsed, 0, "No gas should be used");
        assertEq(result.balanceChange, 0, "Balance should not change");
    }
}
