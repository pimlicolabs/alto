// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/PimlicoSimulations.sol";

import {MessageHashUtils} from "openzeppelin-contracts-v5.0.2/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin-v4.8.3/contracts/utils/cryptography/ECDSA.sol";

import {UserOperation as UserOperation06} from "account-abstraction-v6/interfaces/UserOperation.sol";
import {IEntryPoint as IEntryPoint06} from "account-abstraction-v6/interfaces/IEntryPoint.sol";
import {EntryPoint as EntryPoint06} from "@test-utils/v06/core/EntryPoint.sol";
import {SimpleAccountFactory as SimpleAccountFactory06} from "@test-utils/v06/samples/SimpleAccountFactory.sol";

import {PackedUserOperation as PackedUserOperation07} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {IEntryPoint as IEntryPoint07} from "account-abstraction-v7/interfaces/IEntryPoint.sol";
import {EntryPoint as EntryPoint07} from "@test-utils/v07/core/EntryPoint.sol";
import {SimpleAccountFactory as SimpleAccountFactory07} from "@test-utils/v07/samples/SimpleAccountFactory.sol";

import {PackedUserOperation as PackedUserOperation08} from "account-abstraction-v8/interfaces/PackedUserOperation.sol";
import {IEntryPoint as IEntryPoint08} from "account-abstraction-v8/interfaces/IEntryPoint.sol";
import {EntryPoint as EntryPoint08} from "@test-utils/v08/core/EntryPoint.sol";
import {SimpleAccountFactory as SimpleAccountFactory08} from "@test-utils/v08/accounts/SimpleAccountFactory.sol";

contract FilterOpsTest is Test {
    PimlicoSimulations pimlicoSim;
    SimpleAccountFactory06 accountFactory06;
    SimpleAccountFactory07 accountFactory07;
    SimpleAccountFactory08 accountFactory08;
    EntryPoint06 entryPoint06;
    EntryPoint07 entryPoint07;
    EntryPoint08 entryPoint08;

    address payable beneficiary = payable(address(0x1234));
    address owner;
    uint256 ownerKey;

    function setUp() public {
        (owner, ownerKey) = makeAddrAndKey("alice");
        pimlicoSim = new PimlicoSimulations();
        entryPoint06 = new EntryPoint06();
        entryPoint07 = new EntryPoint07();
        entryPoint08 = new EntryPoint08();
        accountFactory06 = new SimpleAccountFactory06(entryPoint06);
        accountFactory07 = new SimpleAccountFactory07(entryPoint07);
        accountFactory08 = new SimpleAccountFactory08(entryPoint08);
    }

    // ============================================
    // =========== ENTRYPOINT 06 TESTS ============
    // ============================================

    // Test filterOps06 with all valid operations
    function testFilterOps06_AllValid() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount(accountFactory06.getAddress(owner, 0), 0, true);
        accounts[1] = TestAccount(accountFactory06.getAddress(owner, 1), 1, true);
        accounts[2] = TestAccount(accountFactory06.getAddress(owner, 2), 2, true);

        _setupAccounts06(accounts);
        UserOperation06[] memory ops = _createAndSignOps06(accounts);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps06 with one failing operation
    function testFilterOps06_OneFailingOp() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount(accountFactory06.getAddress(owner, 0), 0, true);
        accounts[1] = TestAccount(accountFactory06.getAddress(owner, 1), 1, false); // No funds
        accounts[2] = TestAccount(accountFactory06.getAddress(owner, 2), 2, true);

        _setupAccounts06(accounts);
        UserOperation06[] memory ops = _createAndSignOps06(accounts);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint06.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint06.FailedOp.selector, 1, "AA21 didn't pay prefund")
        );
    }

    // Test filterOps06 with invalid signature
    function testFilterOps06_InvalidSignature() public {
        TestAccount[] memory accounts = new TestAccount[](1);
        accounts[0] = TestAccount(accountFactory06.getAddress(owner, 0), 0, true);

        _setupAccounts06(accounts);
        UserOperation06[] memory ops = _createAndSignOps06(accounts);

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
        TestAccount[] memory accounts = new TestAccount[](2);
        accounts[0] = TestAccount(accountFactory06.getAddress(owner, 0), 0, false);
        accounts[1] = TestAccount(accountFactory06.getAddress(owner, 1), 1, false);

        _setupAccounts06(accounts);
        UserOperation06[] memory ops = _createAndSignOps06(accounts);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        _assertAllFailedResult(result, 2);
    }

    // Test filterOps06 with empty array
    function testFilterOps06_EmptyArray() public {
        UserOperation06[] memory ops = new UserOperation06[](0);
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);
        _assertEmptyResult(result);
    }

    // ============================================
    // =========== ENTRYPOINT 07 TESTS ============
    // ============================================

    // Test filterOps07 with all valid operations
    function testFilterOps07_AllValid() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount(accountFactory07.getAddress(owner, 0), 0, true);
        accounts[1] = TestAccount(accountFactory07.getAddress(owner, 1), 1, true);
        accounts[2] = TestAccount(accountFactory07.getAddress(owner, 2), 2, true);

        _setupAccounts07(accounts);
        PackedUserOperation07[] memory ops = _createAndSignOps07(accounts);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps07 with one failing operation
    function testFilterOps07_OneFailingOp() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount(accountFactory07.getAddress(owner, 0), 0, true);
        accounts[1] = TestAccount(accountFactory07.getAddress(owner, 1), 1, false); // No funds
        accounts[2] = TestAccount(accountFactory07.getAddress(owner, 2), 2, true);

        _setupAccounts07(accounts);
        PackedUserOperation07[] memory ops = _createAndSignOps07(accounts);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint07.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint07.FailedOp.selector, 1, "AA21 didn't pay prefund")
        );
    }

    // Test filterOps07 with invalid signature
    function testFilterOps07_InvalidSignature() public {
        TestAccount[] memory accounts = new TestAccount[](1);
        accounts[0] = TestAccount(accountFactory07.getAddress(owner, 0), 0, true);

        _setupAccounts07(accounts);
        PackedUserOperation07[] memory ops = _createAndSignOps07(accounts);

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
        TestAccount[] memory accounts = new TestAccount[](2);
        accounts[0] = TestAccount(accountFactory07.getAddress(owner, 0), 0, false);
        accounts[1] = TestAccount(accountFactory07.getAddress(owner, 1), 1, false);

        _setupAccounts07(accounts);
        PackedUserOperation07[] memory ops = _createAndSignOps07(accounts);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        _assertAllFailedResult(result, 2);
    }

    // Test filterOps07 with empty array
    function testFilterOps07_EmptyArray() public {
        PackedUserOperation07[] memory ops = new PackedUserOperation07[](0);
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);
        _assertEmptyResult(result);
    }

    // ============================================
    // =========== ENTRYPOINT 08 TESTS ============
    // ============================================

    // Test filterOps08 with all valid operations
    function testFilterOps08_AllValid() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount(accountFactory08.getAddress(owner, 0), 0, true);
        accounts[1] = TestAccount(accountFactory08.getAddress(owner, 1), 1, true);
        accounts[2] = TestAccount(accountFactory08.getAddress(owner, 2), 2, true);

        _setupAccounts08(accounts);
        PackedUserOperation08[] memory ops = _createAndSignOps08(accounts);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps08 with one failing operation
    function testFilterOps08_OneFailingOp() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount(accountFactory08.getAddress(owner, 0), 0, true);
        accounts[1] = TestAccount(accountFactory08.getAddress(owner, 1), 1, false); // No funds
        accounts[2] = TestAccount(accountFactory08.getAddress(owner, 2), 2, true);

        _setupAccounts08(accounts);
        PackedUserOperation08[] memory ops = _createAndSignOps08(accounts);

        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint08.getUserOpHash(ops[1]), "Second op should be rejected"
        );
    }

    // Test filterOps08 with invalid signature
    function testFilterOps08_InvalidSignature() public {
        TestAccount[] memory accounts = new TestAccount[](1);
        accounts[0] = TestAccount(accountFactory08.getAddress(owner, 0), 0, true);

        _setupAccounts08(accounts);
        PackedUserOperation08[] memory ops = _createAndSignOps08(accounts);

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
        TestAccount[] memory accounts = new TestAccount[](2);
        accounts[0] = TestAccount(accountFactory08.getAddress(owner, 0), 0, false);
        accounts[1] = TestAccount(accountFactory08.getAddress(owner, 1), 1, false);

        _setupAccounts08(accounts);
        PackedUserOperation08[] memory ops = _createAndSignOps08(accounts);

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

    // ============================================
    // ================= HELPERS ==================
    // ============================================

    struct TestAccount {
        address addr;
        uint256 salt;
        bool shouldFund;
    }

    function _setupAccounts06(TestAccount[] memory accounts) private {
        for (uint256 i = 0; i < accounts.length; i++) {
            accountFactory06.createAccount(owner, accounts[i].salt);
            if (accounts[i].shouldFund) {
                vm.deal(accounts[i].addr, 1 ether);
            }
        }
    }

    function _setupAccounts07(TestAccount[] memory accounts) private {
        for (uint256 i = 0; i < accounts.length; i++) {
            accountFactory07.createAccount(owner, accounts[i].salt);
            if (accounts[i].shouldFund) {
                vm.deal(accounts[i].addr, 1 ether);
            }
        }
    }

    function _setupAccounts08(TestAccount[] memory accounts) private {
        vm.startPrank(address(entryPoint08.senderCreator()));
        for (uint256 i = 0; i < accounts.length; i++) {
            accountFactory08.createAccount(owner, accounts[i].salt);
            if (accounts[i].shouldFund) {
                vm.deal(accounts[i].addr, 1 ether);
            }
        }
        vm.stopPrank();
    }

    function _createAndSignOps06(TestAccount[] memory accounts) private view returns (UserOperation06[] memory) {
        UserOperation06[] memory ops = new UserOperation06[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            // Build v0.6 UserOperation
            bytes memory initCode = "";
            if (accounts[i].addr.code.length == 0) {
                initCode = abi.encodePacked(
                    address(accountFactory06), abi.encodeCall(accountFactory06.createAccount, (owner, 0))
                );
            }

            ops[i] = UserOperation06({
                sender: accounts[i].addr,
                nonce: 0,
                initCode: initCode,
                callData: "",
                callGasLimit: 100000,
                verificationGasLimit: 150000,
                preVerificationGas: 21000,
                maxFeePerGas: 1 gwei,
                maxPriorityFeePerGas: 1 gwei,
                paymasterAndData: "",
                signature: ""
            });

            // Sign the UserOperation
            bytes32 hash = entryPoint06.getUserOpHash(ops[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, ECDSA.toEthSignedMessageHash(hash));
            ops[i].signature = abi.encodePacked(r, s, v);
        }
        return ops;
    }

    function _createAndSignOps07(TestAccount[] memory accounts) private view returns (PackedUserOperation07[] memory) {
        PackedUserOperation07[] memory ops = new PackedUserOperation07[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            // Build v0.7 PackedUserOperation
            bytes memory initCode = "";
            if (accounts[i].addr.code.length == 0) {
                initCode = abi.encodePacked(
                    address(accountFactory07), abi.encodeCall(accountFactory07.createAccount, (owner, 0))
                );
            }

            // Pack gas limits: verificationGasLimit (16 bytes) | callGasLimit (16 bytes)
            uint256 accountGasLimits = (uint256(150000) << 128) | uint256(100000);

            ops[i] = PackedUserOperation07({
                sender: accounts[i].addr,
                nonce: 0,
                initCode: initCode,
                callData: "",
                accountGasLimits: bytes32(accountGasLimits),
                preVerificationGas: 21000,
                gasFees: bytes32((uint256(1 gwei) << 128) | uint256(1 gwei)), // maxPriorityFeePerGas | maxFeePerGas
                paymasterAndData: "",
                signature: ""
            });

            // Sign the PackedUserOperation
            bytes32 hash = entryPoint07.getUserOpHash(ops[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, MessageHashUtils.toEthSignedMessageHash(hash));
            ops[i].signature = abi.encodePacked(r, s, v);
        }
        return ops;
    }

    function _createAndSignOps08(TestAccount[] memory accounts) private view returns (PackedUserOperation08[] memory) {
        PackedUserOperation08[] memory ops = new PackedUserOperation08[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            // Build v0.8 PackedUserOperation
            bytes memory initCode = "";
            if (accounts[i].addr.code.length == 0) {
                initCode = abi.encodePacked(
                    address(accountFactory08), abi.encodeCall(accountFactory08.createAccount, (owner, 0))
                );
            }

            // Pack gas limits: verificationGasLimit (16 bytes) | callGasLimit (16 bytes)
            uint256 accountGasLimits = (uint256(150000) << 128) | uint256(100000);

            ops[i] = PackedUserOperation08({
                sender: accounts[i].addr,
                nonce: 0,
                initCode: initCode,
                callData: "",
                accountGasLimits: bytes32(accountGasLimits),
                preVerificationGas: 21000,
                gasFees: bytes32((uint256(1 gwei) << 128) | uint256(1 gwei)), // maxPriorityFeePerGas | maxFeePerGas
                paymasterAndData: "",
                signature: ""
            });

            // Sign the PackedUserOperation
            bytes32 hash = entryPoint08.getUserOpHash(ops[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, hash);
            ops[i].signature = abi.encodePacked(r, s, v);
        }
        return ops;
    }

    function castToVersion07(PackedUserOperation08 memory op) internal pure returns (PackedUserOperation07 memory) {
        return PackedUserOperation07({
            sender: op.sender,
            nonce: op.nonce,
            initCode: op.initCode,
            callData: op.callData,
            accountGasLimits: op.accountGasLimits,
            preVerificationGas: op.preVerificationGas,
            gasFees: op.gasFees,
            paymasterAndData: op.paymasterAndData,
            signature: op.signature
        });
    }

    function castToVersion07(PackedUserOperation08[] memory ops)
        internal
        pure
        returns (PackedUserOperation07[] memory)
    {
        PackedUserOperation07[] memory convertedOps = new PackedUserOperation07[](ops.length);
        for (uint256 i = 0; i < ops.length; i++) {
            convertedOps[i] = castToVersion07(ops[i]);
        }
        return convertedOps;
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
