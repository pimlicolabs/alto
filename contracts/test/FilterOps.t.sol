// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/v07/PimlicoSimulations07.sol";

import {EntryPoint as EntryPoint07} from "./aa-utils/07/core/EntryPoint.sol";
import {PackedUserOperation} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {SimpleAccountFactory as SimpleAccountFactory07} from "./aa-utils/07/samples/SimpleAccountFactory.sol";
import {MessageHashUtils} from "openzeppelin-contracts-v5.0.2/contracts/utils/cryptography/MessageHashUtils.sol";

import {EntryPoint as EntryPoint06} from "./aa-utils/06/core/EntryPoint.sol";
import {UserOperation} from "account-abstraction-v6/interfaces/UserOperation.sol";
import {SimpleAccountFactory as SimpleAccountFactory06} from "./aa-utils/06/samples/SimpleAccountFactory.sol";
import {ECDSA} from "@openzeppelin-v4.8.3/contracts/utils/cryptography/ECDSA.sol";

contract FilterOpsTest is Test {
    PimlicoSimulations07 pimlicoSim;
    EntryPoint07 entryPoint07;
    EntryPoint06 entryPoint06;
    SimpleAccountFactory06 accountFactory06;
    SimpleAccountFactory07 accountFactory07;

    address payable beneficiary = payable(address(0x1234));
    address owner;
    uint256 ownerKey;

    function setUp() public {
        (owner, ownerKey) = makeAddrAndKey("alice");
        pimlicoSim = new PimlicoSimulations07();
        entryPoint07 = new EntryPoint07();
        entryPoint06 = new EntryPoint06();
        accountFactory06 = new SimpleAccountFactory06(IEntryPoint06(entryPoint06));
        accountFactory07 = new SimpleAccountFactory07(IEntryPoint07(entryPoint07));
    }

    // Test filterOps07 with all valid operations
    function testFilterOps07_AllValid() public {
        PackedUserOperation[] memory ops = new PackedUserOperation[](3);

        // Create accounts first
        address account1 = accountFactory07.getAddress(owner, 0);
        address account2 = accountFactory07.getAddress(owner, 1);
        address account3 = accountFactory07.getAddress(owner, 2);

        // Deploy and fund accounts
        accountFactory07.createAccount(owner, 0);
        accountFactory07.createAccount(owner, 1);
        accountFactory07.createAccount(owner, 2);

        vm.deal(account1, 1 ether);
        vm.deal(account2, 1 ether);
        vm.deal(account3, 1 ether);

        ops[0] = _createUserOp07(account1, 0);
        ops[1] = _createUserOp07(account2, 0);
        ops[2] = _createUserOp07(account3, 0);

        // Sign operations
        for (uint256 i = 0; i < ops.length; i++) {
            ops[i].signature = _signUserOp(ops[i], ownerKey);
        }

        uint256 balanceBefore = beneficiary.balance;

        PimlicoSimulations07.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        // All operations should pass
        assertEq(result.rejectedUserOps.length, 0, "No operations should be rejected");
        assertGt(result.gasUsed, 0, "Gas should be used");
        assertGt(result.balanceChange, 0, "Balance should increase");
        assertEq(beneficiary.balance - balanceBefore, result.balanceChange, "Balance change should match");
    }

    // Test filterOps07 with one failing operation
    function testFilterOps07_OneFailingOp() public {
        PackedUserOperation[] memory ops = new PackedUserOperation[](3);

        // Create accounts
        address account1 = accountFactory07.getAddress(owner, 0);
        address account2 = accountFactory07.getAddress(owner, 1);
        address account3 = accountFactory07.getAddress(owner, 2);

        // Deploy and fund accounts (but don't fund account2)
        accountFactory07.createAccount(owner, 0);
        accountFactory07.createAccount(owner, 1);
        accountFactory07.createAccount(owner, 2);

        vm.deal(account1, 1 ether);
        // account2 has no funds - will fail
        vm.deal(account3, 1 ether);

        ops[0] = _createUserOp07(account1, 0);
        ops[1] = _createUserOp07(account2, 0);
        ops[2] = _createUserOp07(account3, 0);

        // Sign operations
        for (uint256 i = 0; i < ops.length; i++) {
            ops[i].signature = _signUserOp(ops[i], ownerKey);
        }

        PimlicoSimulations07.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        // One operation should be rejected
        assertEq(result.rejectedUserOps.length, 1, "One operation should be rejected");
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint07.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertGt(result.gasUsed, 0, "Gas should be used");
        assertGt(result.balanceChange, 0, "Balance should increase");
    }

    // Test filterOps07 with all failing operations
    function testFilterOps07_AllFailingOps() public {
        PackedUserOperation[] memory ops = new PackedUserOperation[](2);

        // Create accounts but don't fund them
        address account1 = accountFactory07.getAddress(owner, 0);
        address account2 = accountFactory07.getAddress(owner, 1);

        accountFactory07.createAccount(owner, 0);
        accountFactory07.createAccount(owner, 1);

        ops[0] = _createUserOp07(account1, 0);
        ops[1] = _createUserOp07(account2, 0);

        // Sign operations (accounts have no funds, will fail)
        for (uint256 i = 0; i < ops.length; i++) {
            ops[i].signature = _signUserOp(ops[i], ownerKey);
        }

        PimlicoSimulations07.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        // All operations should be rejected
        assertEq(result.rejectedUserOps.length, 2, "All operations should be rejected");
        assertEq(result.gasUsed, 0, "No gas should be used");
        assertEq(result.balanceChange, 0, "Balance should not change");
    }

    // Test filterOps06 with all valid operations
    function testFilterOps06_AllValid() public {
        UserOperation[] memory ops = new UserOperation[](3);

        // Create accounts first
        address account1 = accountFactory06.getAddress(owner, 0);
        address account2 = accountFactory06.getAddress(owner, 1);
        address account3 = accountFactory06.getAddress(owner, 2);

        // Deploy and fund accounts
        accountFactory06.createAccount(owner, 0);
        accountFactory06.createAccount(owner, 1);
        accountFactory06.createAccount(owner, 2);

        vm.deal(account1, 1 ether);
        vm.deal(account2, 1 ether);
        vm.deal(account3, 1 ether);

        ops[0] = _createUserOp06(account1, 0);
        ops[1] = _createUserOp06(account2, 0);
        ops[2] = _createUserOp06(account3, 0);

        // Sign operations
        for (uint256 i = 0; i < ops.length; i++) {
            ops[i].signature = _signUserOp(ops[i], ownerKey);
        }

        uint256 balanceBefore = beneficiary.balance;

        PimlicoSimulations07.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        // All operations should pass
        assertEq(result.rejectedUserOps.length, 0, "No operations should be rejected");
        assertGt(result.gasUsed, 0, "Gas should be used");
        assertGt(result.balanceChange, 0, "Balance should increase");
        assertEq(beneficiary.balance - balanceBefore, result.balanceChange, "Balance change should match");
    }

    // Test filterOps06 with one failing operation
    function testFilterOps06_OneFailingOp() public {
        UserOperation[] memory ops = new UserOperation[](3);

        // Create accounts
        address account1 = accountFactory06.getAddress(owner, 0);
        address account2 = accountFactory06.getAddress(owner, 1);
        address account3 = accountFactory06.getAddress(owner, 2);

        // Deploy and fund accounts (but don't fund account2)
        accountFactory06.createAccount(owner, 0);
        accountFactory06.createAccount(owner, 1);
        accountFactory06.createAccount(owner, 2);

        vm.deal(account1, 1 ether);
        // account2 has no funds - will fail
        vm.deal(account3, 1 ether);

        ops[0] = _createUserOp06(account1, 0);
        ops[1] = _createUserOp06(account2, 0);
        ops[2] = _createUserOp06(account3, 0);

        // Sign operations
        for (uint256 i = 0; i < ops.length; i++) {
            ops[i].signature = _signUserOp(ops[i], ownerKey);
        }

        PimlicoSimulations07.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        // One operation should be rejected
        assertEq(result.rejectedUserOps.length, 1, "One operation should be rejected");
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint06.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertGt(result.gasUsed, 0, "Gas should be used");
        assertGt(result.balanceChange, 0, "Balance should increase");
    }

    // Test filterOps06 with invalid signature
    function testFilterOps06_InvalidSignature() public {
        UserOperation[] memory ops = new UserOperation[](1);

        address account = accountFactory06.getAddress(owner, 0);
        accountFactory06.createAccount(owner, 0);
        vm.deal(account, 1 ether);

        ops[0] = _createUserOp06(account, 0);
        ops[0].signature = hex"deadbeef"; // Invalid signature

        PimlicoSimulations07.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        // Operation should be rejected
        assertEq(result.rejectedUserOps.length, 1, "Operation should be rejected");
        assertEq(result.gasUsed, 0, "No gas should be used");
        assertEq(result.balanceChange, 0, "Balance should not change");
    }

    // Test filterOps07 with empty array
    function testFilterOps07_EmptyArray() public {
        PackedUserOperation[] memory ops = new PackedUserOperation[](0);

        PimlicoSimulations07.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        assertEq(result.rejectedUserOps.length, 0, "No operations should be rejected");
        assertEq(result.gasUsed, 0, "No gas should be used");
        assertEq(result.balanceChange, 0, "Balance should not change");
    }

    // Test filterOps06 with empty array
    function testFilterOps06_EmptyArray() public {
        UserOperation[] memory ops = new UserOperation[](0);

        PimlicoSimulations07.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        assertEq(result.rejectedUserOps.length, 0, "No operations should be rejected");
        assertEq(result.gasUsed, 0, "No gas should be used");
        assertEq(result.balanceChange, 0, "Balance should not change");
    }

    // ============================================
    // ================= HELPERS ==================
    // ============================================

    function _signUserOp(PackedUserOperation memory op, uint256 _key) private view returns (bytes memory signature) {
        bytes32 hash = entryPoint07.getUserOpHash(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_key, MessageHashUtils.toEthSignedMessageHash(hash));
        signature = abi.encodePacked(r, s, v);
    }

    function _signUserOp(UserOperation memory op, uint256 _key) private view returns (bytes memory signature) {
        bytes32 hash = entryPoint06.getUserOpHash(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_key, ECDSA.toEthSignedMessageHash(hash));
        signature = abi.encodePacked(r, s, v);
    }

    // Helper function to create a valid UserOperation for v0.6
    function _createUserOp06(address sender, uint256 nonce) internal view returns (UserOperation memory) {
        bytes memory initCode = "";
        if (sender.code.length == 0) {
            initCode =
                abi.encodePacked(address(accountFactory06), abi.encodeCall(accountFactory06.createAccount, (owner, 0)));
        }

        return UserOperation({
            sender: sender,
            nonce: nonce,
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
    }

    // Helper function to create a valid PackedUserOperation for v0.7
    function _createUserOp07(address sender, uint256 nonce) internal view returns (PackedUserOperation memory) {
        bytes memory initCode = "";
        if (sender.code.length == 0) {
            initCode =
                abi.encodePacked(address(accountFactory07), abi.encodeCall(accountFactory07.createAccount, (owner, 0)));
        }

        // Pack gas limits: verificationGasLimit (16 bytes) | callGasLimit (16 bytes)
        uint256 accountGasLimits = (uint256(150000) << 128) | uint256(100000);

        return PackedUserOperation({
            sender: sender,
            nonce: nonce,
            initCode: initCode,
            callData: "",
            accountGasLimits: bytes32(accountGasLimits),
            preVerificationGas: 21000,
            gasFees: bytes32((uint256(1 gwei) << 128) | uint256(1 gwei)), // maxPriorityFeePerGas | maxFeePerGas
            paymasterAndData: "",
            signature: ""
        });
    }
}
