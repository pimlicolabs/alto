// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/PimlicoSimulations.sol";

import {ERC20} from "solady/tokens/ERC20.sol";
import {TestERC20} from "@test-utils/TestERC20.sol";

import {UserOperation as UserOperation06} from "account-abstraction-v6/interfaces/UserOperation.sol";
import {IEntryPoint as IEntryPoint06} from "account-abstraction-v6/interfaces/IEntryPoint.sol";
import {EntryPoint as EntryPoint06} from "@test-aa-utils/v06/core/EntryPoint.sol";
import {SimpleAccountFactory as SimpleAccountFactory06} from "@test-aa-utils/v06/samples/SimpleAccountFactory.sol";
import {SimpleAccount as SimpleAccount06} from "@test-aa-utils/v06/samples/SimpleAccount.sol";

import {EntryPointSimulations07} from "../src/v07/EntryPointSimulations.sol";
import {PackedUserOperation as PackedUserOperation07} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {IEntryPoint as IEntryPoint07} from "account-abstraction-v7/interfaces/IEntryPoint.sol";
import {EntryPoint as EntryPoint07} from "@test-aa-utils/v07/core/EntryPoint.sol";
import {SimpleAccountFactory as SimpleAccountFactory07} from "@test-aa-utils/v07/samples/SimpleAccountFactory.sol";
import {SimpleAccount as SimpleAccount07} from "@test-aa-utils/v07/samples/SimpleAccount.sol";

import {ECDSA} from "@openzeppelin-v4.8.3/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "openzeppelin-contracts-v5.0.2/contracts/utils/cryptography/MessageHashUtils.sol";

import {BasicERC20PaymasterV6, BasicERC20PaymasterV7} from "./utils/BasicERC20Paymaster.sol";

contract ERC20PaymasterTest is Test {
    PimlicoSimulations pimlicoSim;
    EntryPoint06 entryPoint06;
    EntryPoint07 entryPoint07;
    SimpleAccountFactory06 accountFactory06;
    SimpleAccountFactory07 accountFactory07;
    IEntryPointSimulations entryPointSimulations07;

    TestERC20 token;
    BasicERC20PaymasterV6 paymaster06;
    BasicERC20PaymasterV7 paymaster07;
    address treasury;
    address owner;
    uint256 ownerKey;

    address payable beneficiary = payable(address(0x1234));

    // Fixed payment amount for testing
    uint256 constant PAYMENT_AMOUNT = 100 ether;

    function setUp() public {
        // Setup accounts
        (owner, ownerKey) = makeAddrAndKey("owner");
        treasury = makeAddr("treasury");

        // Deploy 4337 contracts
        entryPoint06 = new EntryPoint06();
        entryPoint07 = new EntryPoint07();
        accountFactory06 = new SimpleAccountFactory06(entryPoint06);
        accountFactory07 = new SimpleAccountFactory07(entryPoint07);

        // Deploy simulation contracts
        pimlicoSim = new PimlicoSimulations();
        entryPointSimulations07 = new EntryPointSimulations07();

        // Deploy ERC20 token
        token = new TestERC20(18);

        // Deploy basic ERC20 paymasters
        paymaster06 = new BasicERC20PaymasterV6(entryPoint06);
        paymaster07 = new BasicERC20PaymasterV7(entryPoint07);

        // Fund paymasters with ETH for EntryPoint deposits
        vm.deal(address(paymaster06), 100 ether);
        vm.deal(address(paymaster07), 100 ether);
        vm.prank(address(paymaster06));
        entryPoint06.depositTo{value: 100 ether}(address(paymaster06));
        vm.prank(address(paymaster07));
        entryPoint07.depositTo{value: 100 ether}(address(paymaster07));
    }

    // ============================================
    // =========== V0.6 TESTS =====================
    // ============================================

    function testGetErc20BalanceChange06_Success() public {
        // Create account and fund with tokens
        address account = accountFactory06.getAddress(owner, 0);
        accountFactory06.createAccount(owner, 0);
        vm.deal(account, 1 ether);
        token.sudoMint(account, 1000 ether);

        // Approve paymaster to spend tokens
        vm.prank(account);
        token.approve(address(paymaster06), type(uint256).max);

        // Build UserOperation with ERC20 paymaster data
        UserOperation06 memory userOp = _createUserOp06WithERC20Paymaster(
            account, 0, abi.encodeWithSelector(SimpleAccount06.execute.selector, address(0), 0, "")
        );

        // Test balance change
        uint256 balanceChange =
            pimlicoSim.getErc20BalanceChange06(userOp, address(entryPoint06), ERC20(address(token)), treasury);

        // Should show balance change equal to PAYMENT_AMOUNT
        assertEq(balanceChange, PAYMENT_AMOUNT, "Treasury should receive exactly PAYMENT_AMOUNT tokens");
    }

    function testGetErc20BalanceChange06_InsufficientBalance() public {
        // Create account without funding it with enough tokens
        address account = accountFactory06.getAddress(owner, 0);
        accountFactory06.createAccount(owner, 0);
        vm.deal(account, 1 ether);
        token.sudoMint(account, 1 ether); // Very small amount

        // Approve paymaster to spend tokens
        vm.prank(account);
        token.approve(address(paymaster06), type(uint256).max);

        // Build UserOperation with high gas limits
        UserOperation06 memory userOp = _createUserOp06WithERC20Paymaster(
            account, 0, abi.encodeWithSelector(SimpleAccount06.execute.selector, address(0), 0, "")
        );
        userOp.callGasLimit = 1_000_000;
        userOp.verificationGasLimit = 1_000_000;

        // Re-sign with updated gas limits
        bytes32 hash = entryPoint06.getUserOpHash(userOp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, ECDSA.toEthSignedMessageHash(hash));
        userOp.signature = abi.encodePacked(r, s, v);

        // Test should revert due to insufficient token balance
        vm.expectRevert();
        pimlicoSim.getErc20BalanceChange06(userOp, address(entryPoint06), ERC20(address(token)), treasury);
    }

    // ============================================
    // =========== V0.7 TESTS =====================
    // ============================================

    function testGetErc20BalanceChange07_Success() public {
        // Create account and fund with tokens
        address account = accountFactory07.getAddress(owner, 0);
        accountFactory07.createAccount(owner, 0);
        vm.deal(account, 1 ether);
        token.sudoMint(account, 1000 ether);

        // Approve paymaster to spend tokens
        vm.prank(account);
        token.approve(address(paymaster07), type(uint256).max);

        // Build PackedUserOperation with ERC20 paymaster data
        PackedUserOperation07 memory userOp = _createPackedUserOp07WithERC20Paymaster(
            account, 0, abi.encodeWithSelector(SimpleAccount07.execute.selector, address(0), 0, "")
        );

        // Test balance change
        uint256 balanceChange = pimlicoSim.getErc20BalanceChange07(
            address(entryPointSimulations07), payable(address(entryPoint07)), userOp, ERC20(address(token)), treasury
        );

        // Should show balance change equal to PAYMENT_AMOUNT
        assertEq(balanceChange, PAYMENT_AMOUNT, "Treasury should receive exactly PAYMENT_AMOUNT tokens");
    }

    function testGetErc20BalanceChange07_InsufficientBalance() public {
        // Create account without funding it with enough tokens
        address account = accountFactory07.getAddress(owner, 0);
        accountFactory07.createAccount(owner, 0);
        vm.deal(account, 1 ether);
        token.sudoMint(account, 1 ether); // Very small amount

        // Approve paymaster to spend tokens
        vm.prank(account);
        token.approve(address(paymaster07), type(uint256).max);

        // Build PackedUserOperation with high gas limits
        PackedUserOperation07 memory userOp = _createPackedUserOp07WithERC20Paymaster(
            account, 0, abi.encodeWithSelector(SimpleAccount07.execute.selector, address(0), 0, "")
        );

        // Increase gas limits to force higher payment
        uint256 highGasLimit = (uint256(1_000_000) << 128) | uint256(1_000_000);
        userOp.accountGasLimits = bytes32(highGasLimit);

        // Re-sign with updated gas limits
        bytes32 hash = entryPoint07.getUserOpHash(userOp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, MessageHashUtils.toEthSignedMessageHash(hash));
        userOp.signature = abi.encodePacked(r, s, v);

        // Test should revert due to insufficient token balance
        vm.expectRevert();
        pimlicoSim.getErc20BalanceChange07(
            address(entryPointSimulations07), payable(address(entryPoint07)), userOp, ERC20(address(token)), treasury
        );
    }

    // ============================================
    // ================= HELPERS ==================
    // ============================================

    function _createUserOp06WithERC20Paymaster(address sender, uint256 nonce, bytes memory callData)
        private
        view
        returns (UserOperation06 memory)
    {
        bytes memory initCode = "";
        if (sender.code.length == 0) {
            initCode =
                abi.encodePacked(address(accountFactory06), abi.encodeCall(accountFactory06.createAccount, (owner, 0)));
        }

        UserOperation06 memory userOp = UserOperation06({
            sender: sender,
            nonce: nonce,
            initCode: initCode,
            callData: callData,
            callGasLimit: 200000,
            verificationGasLimit: 150000,
            preVerificationGas: 21000,
            maxFeePerGas: 1 gwei,
            maxPriorityFeePerGas: 1 gwei,
            paymasterAndData: _getERC20PaymasterData06(),
            signature: ""
        });

        // Sign the UserOperation
        bytes32 hash = entryPoint06.getUserOpHash(userOp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, ECDSA.toEthSignedMessageHash(hash));
        userOp.signature = abi.encodePacked(r, s, v);

        return userOp;
    }

    function _createPackedUserOp07WithERC20Paymaster(address sender, uint256 nonce, bytes memory callData)
        private
        view
        returns (PackedUserOperation07 memory)
    {
        bytes memory initCode = "";
        if (sender.code.length == 0) {
            initCode =
                abi.encodePacked(address(accountFactory07), abi.encodeCall(accountFactory07.createAccount, (owner, 0)));
        }

        // Pack gas limits: verificationGasLimit (16 bytes) | callGasLimit (16 bytes)
        uint256 accountGasLimits = (uint256(150000) << 128) | uint256(200000);

        PackedUserOperation07 memory userOp = PackedUserOperation07({
            sender: sender,
            nonce: nonce,
            initCode: initCode,
            callData: callData,
            accountGasLimits: bytes32(accountGasLimits),
            preVerificationGas: 21000,
            gasFees: bytes32((uint256(1 gwei) << 128) | uint256(1 gwei)), // maxPriorityFeePerGas | maxFeePerGas
            paymasterAndData: _getERC20PaymasterData07(),
            signature: ""
        });

        // Sign the PackedUserOperation
        bytes32 hash = entryPoint07.getUserOpHash(userOp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, MessageHashUtils.toEthSignedMessageHash(hash));
        userOp.signature = abi.encodePacked(r, s, v);

        return userOp;
    }

    function _getERC20PaymasterData06() private view returns (bytes memory) {
        // Basic ERC20 paymaster data format for v0.6
        // Format: paymaster address + (token, treasury, amount)
        return abi.encodePacked(address(paymaster06), abi.encode(address(token), treasury, PAYMENT_AMOUNT));
    }

    function _getERC20PaymasterData07() private view returns (bytes memory) {
        // Basic ERC20 paymaster data format for v0.7
        // Format: paymaster address + verificationGasLimit + postOpGasLimit + (token, treasury, amount)
        return abi.encodePacked(
            address(paymaster07),
            uint128(100000), // paymasterVerificationGasLimit
            uint128(50000), // paymasterPostOpGasLimit
            abi.encode(address(token), treasury, PAYMENT_AMOUNT)
        );
    }
}
