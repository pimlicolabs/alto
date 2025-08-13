// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/PimlicoSimulations.sol";

import {UserOpHelper} from "./utils/UserOpHelper.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {MessageHashUtils} from "openzeppelin-contracts-v5.0.2/contracts/utils/cryptography/MessageHashUtils.sol";

import {UserOperation as UserOperation06} from "account-abstraction-v6/interfaces/UserOperation.sol";
import {IEntryPoint as IEntryPoint06} from "account-abstraction-v6/interfaces/IEntryPoint.sol";
import {EntryPoint as EntryPoint06} from "@test-aa-utils/v06/core/EntryPoint.sol";
import {SimpleAccountFactory as SimpleAccountFactory06} from "@test-aa-utils/v06/samples/SimpleAccountFactory.sol";
import {SimpleAccount as SimpleAccount06} from "@test-aa-utils/v06/samples/SimpleAccount.sol";

import {PackedUserOperation as PackedUserOperation07} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {IEntryPoint as IEntryPoint07} from "account-abstraction-v7/interfaces/IEntryPoint.sol";
import {IEntryPointSimulations} from "../src/IEntryPointSimulations.sol";
import {EntryPoint as EntryPoint07} from "@test-aa-utils/v07/core/EntryPoint.sol";
import {EntryPointSimulations07} from "../src/v07/EntryPointSimulations.sol";
import {SimpleAccountFactory as SimpleAccountFactory07} from "@test-aa-utils/v07/samples/SimpleAccountFactory.sol";
import {SimpleAccount as SimpleAccount07} from "@test-aa-utils/v07/samples/SimpleAccount.sol";

import {PackedUserOperation as PackedUserOperation08} from "account-abstraction-v8/interfaces/PackedUserOperation.sol";
import {BaseAccount as SimpleAccount08} from "@test-aa-utils/v08/accounts/SimpleAccount.sol";
import {EntryPointSimulations08} from "../src/v08/EntryPointSimulations.sol";

contract SimulateAssetChangeTest is UserOpHelper {
    PimlicoSimulations pimlicoSim;

    EntryPointSimulations07 entryPointSimulations07;
    EntryPointSimulations08 entryPointSimulations08;

    ERC20Mock token1;
    ERC20Mock token2;

    address constant ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function setUp() public {
        // Setup EntryPoints, factories and owner key from UserOpHelper
        setupTestEnvironment("alice");

        // Deploy simulation contracts
        pimlicoSim = new PimlicoSimulations();

        // Deploy EntryPointSimulations for 0.7 and 0.8
        entryPointSimulations07 = new EntryPointSimulations07();
        entryPointSimulations08 = new EntryPointSimulations08();

        // Deploy mock ERC20 tokens
        token1 = new ERC20Mock();
        token2 = new ERC20Mock();
    }

    // ============================================
    // =========== ENTRYPOINT 06 TESTS ============
    // ============================================

    // Test simulateAssetChange06 with ETH transfer
    function testSimulateAssetChange06_ETHTransfer() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 0.5 ether;

        // Setup
        UserOperation06 memory userOp = createSignedUserOp06(salt, _createTransferCall(recipient, transferAmount), "");
        _setupAccountWithFunds(salt, 1 ether);

        uint256 senderBalanceBeforeSim = userOp.sender.balance;
        uint256 recipientBalanceBeforeSim = recipient.balance;

        // Simulate
        (PimlicoSimulations.BalanceChange[] memory changes,) = pimlicoSim.simulateAssetChange06(
            userOp,
            entryPoint06,
            _createBalanceQueries(ETH_ADDRESS, userOp.sender, recipient),
            _createEmptyAllowanceQueries()
        );

        // Verify
        assertEq(changes.length, 2, "Should have 2 ETH balance changes");
        _verifyBalanceChange(changes[0], userOp.sender, ETH_ADDRESS, senderBalanceBeforeSim, changes[0].balanceAfter);
        assertLt(changes[0].balanceAfter, senderBalanceBeforeSim - transferAmount, "Sender should pay transfer + gas");
        _verifyBalanceChange(
            changes[1], recipient, ETH_ADDRESS, recipientBalanceBeforeSim, recipientBalanceBeforeSim + transferAmount
        );
    }

    // Test simulateAssetChange06 with ERC20 token transfer
    function testSimulateAssetChange06_TokenTransfer() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 100e18;

        // Setup
        _mintTokens(salt, 1000e18, 0);
        UserOperation06 memory userOp =
            createSignedUserOp06(salt, _createTokenTransferCall(address(token1), recipient, transferAmount), "");
        _setupAccountWithFunds(salt, 1 ether);

        uint256 senderTokenBalanceBeforeSim = token1.balanceOf(userOp.sender);
        uint256 recipientTokenBalanceBeforeSim = token1.balanceOf(recipient);

        // Simulate
        (PimlicoSimulations.BalanceChange[] memory changes,) = pimlicoSim.simulateAssetChange06(
            userOp,
            entryPoint06,
            _createBalanceQueries(address(token1), userOp.sender, recipient),
            _createEmptyAllowanceQueries()
        );

        // Verify
        assertEq(changes.length, 2, "Should have 2 token changes");
        _verifyBalanceChange(
            changes[0],
            userOp.sender,
            address(token1),
            senderTokenBalanceBeforeSim,
            senderTokenBalanceBeforeSim - transferAmount
        );
        _verifyBalanceChange(
            changes[1],
            recipient,
            address(token1),
            recipientTokenBalanceBeforeSim,
            recipientTokenBalanceBeforeSim + transferAmount
        );
    }

    // Test simulateAssetChange06 with multiple asset changes (ETH + tokens)
    function testSimulateAssetChange06_MultipleAssets() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 ethAmount = 0.1 ether;
        uint256 token1Amount = 50e18;
        uint256 token2Amount = 75e18;

        // Setup
        _mintTokens(salt, 1000e18, 1000e18);
        UserOpHelper.Call[] memory calls = new UserOpHelper.Call[](3);
        calls[0] = _createTransferCall(recipient, ethAmount);
        calls[1] = _createTokenTransferCall(address(token1), recipient, token1Amount);
        calls[2] = _createTokenTransferCall(address(token2), recipient, token2Amount);

        UserOperation06 memory userOp = createSignedUserOp06(salt, calls, "");
        _setupAccountWithFunds(salt, 1 ether);

        // Simulate
        (PimlicoSimulations.BalanceChange[] memory changes,) = pimlicoSim.simulateAssetChange06(
            userOp,
            entryPoint06,
            _createBalanceQueries(
                _createTokens(address(token1), address(token2)), _createOwners(userOp.sender, recipient)
            ),
            _createEmptyAllowanceQueries()
        );

        // Verify
        assertEq(changes.length, 4, "Should have 4 total changes (2 token1 + 2 token2)");
        uint256 token1Changes = 0;
        uint256 token2Changes = 0;
        for (uint256 i = 0; i < changes.length; i++) {
            if (changes[i].token == address(token1)) token1Changes++;
            else if (changes[i].token == address(token2)) token2Changes++;
        }
        assertEq(token1Changes, 2, "Should have 2 token1 changes");
        assertEq(token2Changes, 2, "Should have 2 token2 changes");
    }

    // Test simulateAssetChange06 with no changes
    function testSimulateAssetChange06_NoChanges() public {
        uint256 salt = 0;

        // Setup
        UserOperation06 memory userOp =
            createSignedUserOp06(salt, UserOpHelper.Call({to: address(0), value: 0, data: ""}), "");
        _setupAccountWithFunds(salt, 1 ether);
        uint256 senderBalanceBeforeSim = userOp.sender.balance;

        // Simulate
        (PimlicoSimulations.BalanceChange[] memory changes,) = pimlicoSim.simulateAssetChange06(
            userOp, entryPoint06, _createBalanceQuery(ETH_ADDRESS, userOp.sender), _createEmptyAllowanceQueries()
        );

        // Verify
        assertEq(changes.length, 1, "Should only have 1 change for gas");
        _verifyBalanceChange(changes[0], userOp.sender, ETH_ADDRESS, senderBalanceBeforeSim, changes[0].balanceAfter);
        assertLt(changes[0].balanceAfter, changes[0].balanceBefore, "ETH should decrease due to gas");
    }

    // Test simulateAssetChange06 with ERC20 allowance changes
    function testSimulateAssetChange06_AllowanceChange() public {
        uint256 salt = 0;
        address spender = address(0x5678);
        uint256 approveAmount = 500e18;

        // Setup
        _mintTokens(salt, 1000e18, 0);
        UserOperation06 memory userOp =
            createSignedUserOp06(salt, _createApproveCall(address(token1), spender, approveAmount), "");
        _setupAccountWithFunds(salt, 1 ether);

        uint256 allowanceBeforeSim = token1.allowance(userOp.sender, spender);

        // Simulate
        (, PimlicoSimulations.AllowanceChange[] memory allowanceChanges) = pimlicoSim.simulateAssetChange06(
            userOp,
            entryPoint06,
            _createBalanceQuery(address(token1), userOp.sender),
            _createAllowanceQuery(address(token1), userOp.sender, spender)
        );

        // Verify
        assertEq(allowanceChanges.length, 1, "Should have 1 allowance change");
        _verifyAllowanceChange(
            allowanceChanges[0], userOp.sender, address(token1), spender, allowanceBeforeSim, approveAmount
        );
    }

    // Test simulateAssetChange06 with invalid nonce (should revert with AA25)
    function testSimulateAssetChange06_InvalidNonce() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 0.1 ether;

        // Setup
        UserOperation06 memory userOp = createSignedUserOp06(salt, _createTransferCall(recipient, transferAmount), "");
        _setupAccountWithFunds(salt, 1 ether);
        userOp.nonce = userOp.nonce + 1; // Make nonce invalid

        // Expect revert
        vm.expectRevert(abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA25 invalid account nonce"));
        pimlicoSim.simulateAssetChange06(
            userOp,
            entryPoint06,
            _createBalanceQueries(ETH_ADDRESS, userOp.sender, recipient),
            _createEmptyAllowanceQueries()
        );
    }

    // ============================================
    // =========== ENTRYPOINT 07 TESTS ============
    // ============================================

    // Test simulateAssetChange07 with ETH transfer
    function testSimulateAssetChange07_ETHTransfer() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 0.5 ether;

        // Setup
        PackedUserOperation07 memory userOp =
            createSignedUserOp07(salt, _createTransferCall(recipient, transferAmount), "");
        _setupAccountWithFunds(salt, 1 ether);
        uint256 senderBalanceBeforeSim = userOp.sender.balance;
        uint256 recipientBalanceBeforeSim = recipient.balance;

        // Simulate
        (PimlicoSimulations.BalanceChange[] memory changes,) = pimlicoSim.simulateAssetChange07(
            userOp,
            address(entryPointSimulations07),
            entryPoint07,
            _createBalanceQueries(ETH_ADDRESS, userOp.sender, recipient),
            _createEmptyAllowanceQueries()
        );

        // Verify
        assertEq(changes.length, 2, "Should have 2 ETH balance changes");
        for (uint256 i = 0; i < changes.length; i++) {
            if (changes[i].owner == userOp.sender) {
                _verifyBalanceChange(
                    changes[i], userOp.sender, ETH_ADDRESS, senderBalanceBeforeSim, changes[i].balanceAfter
                );
                assertLt(changes[i].balanceAfter, senderBalanceBeforeSim - transferAmount, "Should include gas");
            } else if (changes[i].owner == recipient) {
                _verifyBalanceChange(
                    changes[i],
                    recipient,
                    ETH_ADDRESS,
                    recipientBalanceBeforeSim,
                    recipientBalanceBeforeSim + transferAmount
                );
            }
        }
    }

    // Test simulateAssetChange07 with token transfer
    function testSimulateAssetChange07_TokenTransfer() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 100e18;

        // Setup
        _mintTokens(salt, 1000e18, 0);
        PackedUserOperation07 memory userOp =
            createSignedUserOp07(salt, _createTokenTransferCall(address(token1), recipient, transferAmount), "");
        _setupAccountWithFunds(salt, 1 ether);
        uint256 senderTokenBalanceBeforeSim = token1.balanceOf(userOp.sender);
        uint256 recipientTokenBalanceBeforeSim = token1.balanceOf(recipient);

        // Simulate
        (PimlicoSimulations.BalanceChange[] memory changes,) = pimlicoSim.simulateAssetChange07(
            userOp,
            address(entryPointSimulations07),
            entryPoint07,
            _createBalanceQueries(address(token1), userOp.sender, recipient),
            _createEmptyAllowanceQueries()
        );

        // Verify
        assertEq(changes.length, 2, "Should have 2 token changes");
        _verifyBalanceChange(
            changes[0],
            userOp.sender,
            address(token1),
            senderTokenBalanceBeforeSim,
            senderTokenBalanceBeforeSim - transferAmount
        );
        _verifyBalanceChange(
            changes[1],
            recipient,
            address(token1),
            recipientTokenBalanceBeforeSim,
            recipientTokenBalanceBeforeSim + transferAmount
        );
    }

    // Test simulateAssetChange07 with multiple asset changes (ETH + tokens)
    function testSimulateAssetChange07_MultipleAssets() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 ethAmount = 0.1 ether;
        uint256 token1Amount = 50e18;
        uint256 token2Amount = 75e18;

        // Setup
        _mintTokens(salt, 1000e18, 1000e18);
        UserOpHelper.Call[] memory calls = new UserOpHelper.Call[](3);
        calls[0] = _createTransferCall(recipient, ethAmount);
        calls[1] = _createTokenTransferCall(address(token1), recipient, token1Amount);
        calls[2] = _createTokenTransferCall(address(token2), recipient, token2Amount);

        PackedUserOperation07 memory userOp = createSignedUserOp07(salt, calls, "");
        _setupAccountWithFunds(salt, 1 ether);

        // Simulate
        (PimlicoSimulations.BalanceChange[] memory changes,) = pimlicoSim.simulateAssetChange07(
            userOp,
            address(entryPointSimulations07),
            entryPoint07,
            _createBalanceQueries(
                _createTokens(address(token1), address(token2)), _createOwners(userOp.sender, recipient)
            ),
            _createEmptyAllowanceQueries()
        );

        // Verify
        assertEq(changes.length, 4, "Should have 4 total changes (2 token1 + 2 token2)");
        uint256 token1Changes = 0;
        uint256 token2Changes = 0;
        for (uint256 i = 0; i < changes.length; i++) {
            if (changes[i].token == address(token1)) token1Changes++;
            else if (changes[i].token == address(token2)) token2Changes++;
        }
        assertEq(token1Changes, 2, "Should have 2 token1 changes");
        assertEq(token2Changes, 2, "Should have 2 token2 changes");
    }

    // Test simulateAssetChange07 with no changes
    function testSimulateAssetChange07_NoChanges() public {
        uint256 salt = 0;

        // Setup
        PackedUserOperation07 memory userOp =
            createSignedUserOp07(salt, UserOpHelper.Call({to: address(0), value: 0, data: ""}), "");
        _setupAccountWithFunds(salt, 1 ether);
        uint256 senderBalanceBeforeSim = userOp.sender.balance;

        // Simulate
        (PimlicoSimulations.BalanceChange[] memory changes,) = pimlicoSim.simulateAssetChange07(
            userOp,
            address(entryPointSimulations07),
            entryPoint07,
            _createBalanceQuery(ETH_ADDRESS, userOp.sender),
            _createEmptyAllowanceQueries()
        );

        // Verify
        assertEq(changes.length, 1, "Should only have 1 change for gas");
        _verifyBalanceChange(changes[0], userOp.sender, ETH_ADDRESS, senderBalanceBeforeSim, changes[0].balanceAfter);
        assertLt(changes[0].balanceAfter, changes[0].balanceBefore, "ETH should decrease due to gas");
    }

    // Test simulateAssetChange07 with ERC20 allowance changes
    function testSimulateAssetChange07_AllowanceChange() public {
        uint256 salt = 0;
        address spender = address(0x5678);
        uint256 approveAmount = 500e18;

        // Setup
        _mintTokens(salt, 1000e18, 0);
        PackedUserOperation07 memory userOp =
            createSignedUserOp07(salt, _createApproveCall(address(token1), spender, approveAmount), "");
        _setupAccountWithFunds(salt, 1 ether);
        uint256 allowanceBeforeSim = token1.allowance(userOp.sender, spender);

        // Simulate
        (, PimlicoSimulations.AllowanceChange[] memory allowanceChanges) = pimlicoSim.simulateAssetChange07(
            userOp,
            address(entryPointSimulations07),
            entryPoint07,
            _createBalanceQuery(address(token1), userOp.sender),
            _createAllowanceQuery(address(token1), userOp.sender, spender)
        );

        // Verify
        assertEq(allowanceChanges.length, 1, "Should have 1 allowance change");
        _verifyAllowanceChange(
            allowanceChanges[0], userOp.sender, address(token1), spender, allowanceBeforeSim, approveAmount
        );
    }

    // Test simulateAssetChange07 with invalid nonce (should revert with AA25)
    function testSimulateAssetChange07_InvalidNonce() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 0.1 ether;

        // Setup
        PackedUserOperation07 memory userOp =
            createSignedUserOp07(salt, _createTransferCall(recipient, transferAmount), "");
        _setupAccountWithFunds(salt, 1 ether);
        userOp.nonce = userOp.nonce + 1; // Make nonce invalid

        // Expect revert
        vm.expectRevert(abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA25 invalid account nonce"));
        pimlicoSim.simulateAssetChange07(
            userOp,
            address(entryPointSimulations07),
            entryPoint07,
            _createBalanceQueries(ETH_ADDRESS, userOp.sender, recipient),
            _createEmptyAllowanceQueries()
        );
    }

    // ============================================
    // =========== ENTRYPOINT 08 TESTS ============
    // ============================================

    // Test simulateAssetChange08 with ETH transfer
    function testSimulateAssetChange08_ETHTransfer() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 0.5 ether;

        // Create call to transfer ETH
        UserOpHelper.Call memory call = UserOpHelper.Call({to: recipient, value: transferAmount, data: ""});
        bytes memory paymasterAndData = "";
        PackedUserOperation08 memory userOp = createSignedUserOp08(salt, call, paymasterAndData);

        // Fund the account
        vm.deal(userOp.sender, 1 ether);

        // Record balances before simulation
        uint256 senderBalanceBeforeSim = userOp.sender.balance;
        uint256 recipientBalanceBeforeSim = recipient.balance;

        // Simulate asset changes (v0.8 uses v0.7 format)
        (PimlicoSimulations.BalanceChange[] memory changes,) = pimlicoSim.simulateAssetChange08(
            castToVersion07(userOp),
            address(entryPointSimulations08),
            entryPoint08,
            _createBalanceQueries(ETH_ADDRESS, userOp.sender, recipient),
            _createEmptyAllowanceQueries()
        );

        // Verify results
        assertEq(changes.length, 2, "Should have 2 ETH balance changes");

        // Verify ETH changes
        for (uint256 i = 0; i < changes.length; i++) {
            assertEq(changes[i].token, ETH_ADDRESS, "All changes should be ETH");
            if (changes[i].owner == userOp.sender) {
                assertEq(changes[i].balanceBefore, senderBalanceBeforeSim, "Sender balanceBefore should match");
                assertLt(changes[i].balanceAfter, changes[i].balanceBefore, "Sender ETH should decrease");
                assertLt(changes[i].balanceAfter, senderBalanceBeforeSim - transferAmount, "Should include gas");
            } else if (changes[i].owner == recipient) {
                assertEq(changes[i].balanceBefore, recipientBalanceBeforeSim, "Recipient balanceBefore should match");
                assertEq(
                    changes[i].balanceAfter,
                    recipientBalanceBeforeSim + transferAmount,
                    "Recipient should receive exact amount"
                );
            }
        }
    }

    // Test simulateAssetChange08 with token transfer
    function testSimulateAssetChange08_TokenTransfer() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 100e18;

        // Mint tokens to the account that will be created
        address sender = accountFactory08.getAddress(owner, salt);
        token1.mint(sender, 1000e18);

        // Create call to transfer tokens
        bytes memory transferData = abi.encodeWithSelector(token1.transfer.selector, recipient, transferAmount);
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(token1), value: 0, data: transferData});
        bytes memory paymasterAndData = "";
        PackedUserOperation08 memory userOp = createSignedUserOp08(salt, call, paymasterAndData);

        // Fund the account for gas
        vm.deal(userOp.sender, 1 ether);

        // Record token balances before simulation
        uint256 senderTokenBalanceBeforeSim = token1.balanceOf(userOp.sender);
        uint256 recipientTokenBalanceBeforeSim = token1.balanceOf(recipient);

        // Simulate asset changes
        (PimlicoSimulations.BalanceChange[] memory changes,) = pimlicoSim.simulateAssetChange08(
            castToVersion07(userOp),
            address(entryPointSimulations08),
            entryPoint08,
            _createBalanceQueries(address(token1), userOp.sender, recipient),
            _createEmptyAllowanceQueries()
        );

        // Verify results
        assertEq(changes.length, 2, "Should have 2 token changes");

        // Verify token changes
        for (uint256 i = 0; i < changes.length; i++) {
            assertEq(changes[i].token, address(token1), "All changes should be for token1");
            if (changes[i].owner == userOp.sender) {
                assertEq(changes[i].balanceBefore, senderTokenBalanceBeforeSim, "Sender balanceBefore should match");
                assertEq(
                    changes[i].balanceAfter,
                    senderTokenBalanceBeforeSim - transferAmount,
                    "Sender tokens should decrease"
                );
            } else if (changes[i].owner == recipient) {
                assertEq(
                    changes[i].balanceBefore, recipientTokenBalanceBeforeSim, "Recipient balanceBefore should match"
                );
                assertEq(
                    changes[i].balanceAfter,
                    recipientTokenBalanceBeforeSim + transferAmount,
                    "Recipient tokens should increase"
                );
            }
        }
    }

    // Test simulateAssetChange08 with multiple asset changes (ETH + tokens)
    function testSimulateAssetChange08_MultipleAssets() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 ethAmount = 0.1 ether;
        uint256 token1Amount = 50e18;
        uint256 token2Amount = 75e18;

        // Mint tokens to the account that will be created
        address sender = accountFactory08.getAddress(owner, salt);
        token1.mint(sender, 1000e18);
        token2.mint(sender, 1000e18);

        // Create array of calls for batch execution
        UserOpHelper.Call[] memory calls = new UserOpHelper.Call[](3);

        // ETH transfer
        calls[0] = UserOpHelper.Call({to: recipient, value: ethAmount, data: ""});

        // Token1 transfer
        calls[1] = UserOpHelper.Call({
            to: address(token1),
            value: 0,
            data: abi.encodeWithSelector(token1.transfer.selector, recipient, token1Amount)
        });

        // Token2 transfer
        calls[2] = UserOpHelper.Call({
            to: address(token2),
            value: 0,
            data: abi.encodeWithSelector(token2.transfer.selector, recipient, token2Amount)
        });

        // Create user operation with the batch calls
        bytes memory paymasterAndData = "";
        PackedUserOperation08 memory userOp = createSignedUserOp08(salt, calls, paymasterAndData);

        // Fund the account for gas and ETH transfer
        vm.deal(userOp.sender, 1 ether);

        // Simulate asset changes
        (PimlicoSimulations.BalanceChange[] memory changes,) = pimlicoSim.simulateAssetChange08(
            castToVersion07(userOp),
            address(entryPointSimulations08),
            entryPoint08,
            _createBalanceQueries(
                _createTokens(address(token1), address(token2)), _createOwners(userOp.sender, recipient)
            ),
            _createEmptyAllowanceQueries()
        );

        // Verify we have changes for tracked tokens only
        assertEq(changes.length, 4, "Should have 4 total changes (2 token1 + 2 token2)");

        // Count changes by type
        uint256 token1Changes = 0;
        uint256 token2Changes = 0;

        for (uint256 i = 0; i < changes.length; i++) {
            if (changes[i].token == address(token1)) {
                token1Changes++;
            } else if (changes[i].token == address(token2)) {
                token2Changes++;
            }
        }

        assertEq(token1Changes, 2, "Should have 2 token1 changes");
        assertEq(token2Changes, 2, "Should have 2 token2 changes");
    }

    // Test simulateAssetChange08 with no changes
    function testSimulateAssetChange08_NoChanges() public {
        uint256 salt = 0;

        // Create a no-op call
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        bytes memory paymasterAndData = "";
        PackedUserOperation08 memory userOp = createSignedUserOp08(salt, call, paymasterAndData);

        // Fund the account
        vm.deal(userOp.sender, 1 ether);

        // Record balance before simulation
        uint256 senderBalanceBeforeSim = userOp.sender.balance;

        // Simulate asset changes
        (PimlicoSimulations.BalanceChange[] memory changes,) = pimlicoSim.simulateAssetChange08(
            castToVersion07(userOp),
            address(entryPointSimulations08),
            entryPoint08,
            _createBalanceQuery(ETH_ADDRESS, userOp.sender),
            _createEmptyAllowanceQueries()
        );

        // Should only have gas cost change
        assertEq(changes.length, 1, "Should only have 1 change for gas");
        assertEq(changes[0].owner, userOp.sender);
        assertEq(changes[0].token, ETH_ADDRESS);
        assertEq(changes[0].balanceBefore, senderBalanceBeforeSim, "balanceBefore should match current balance");
        assertLt(changes[0].balanceAfter, changes[0].balanceBefore, "ETH should decrease due to gas");
    }

    // Test simulateAssetChange08 with ERC20 allowance changes
    function testSimulateAssetChange08_AllowanceChange() public {
        uint256 salt = 0;
        address spender = address(0x5678);
        uint256 approveAmount = 500e18;

        // Mint tokens to the account that will be created
        address sender = accountFactory08.getAddress(owner, salt);
        token1.mint(sender, 1000e18);

        // Create call to approve tokens
        bytes memory approveData = abi.encodeWithSelector(token1.approve.selector, spender, approveAmount);
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(token1), value: 0, data: approveData});
        bytes memory paymasterAndData = "";
        PackedUserOperation08 memory userOp = createSignedUserOp08(salt, call, paymasterAndData);

        // Fund the account for gas
        vm.deal(userOp.sender, 1 ether);

        // Record allowance before simulation
        uint256 allowanceBeforeSim = token1.allowance(userOp.sender, spender);

        // Simulate asset changes (v0.8 uses v0.7 format)
        (, PimlicoSimulations.AllowanceChange[] memory allowanceChanges) = pimlicoSim.simulateAssetChange08(
            castToVersion07(userOp),
            address(entryPointSimulations08),
            entryPoint08,
            _createBalanceQuery(address(token1), userOp.sender),
            _createAllowanceQuery(address(token1), userOp.sender, spender)
        );

        // Verify allowance changes
        assertEq(allowanceChanges.length, 1, "Should have 1 allowance change");
        assertEq(allowanceChanges[0].owner, userOp.sender);
        assertEq(allowanceChanges[0].token, address(token1));
        assertEq(allowanceChanges[0].spender, spender);
        assertEq(allowanceChanges[0].allowanceBefore, allowanceBeforeSim, "Allowance before should match");
        assertEq(allowanceChanges[0].allowanceAfter, approveAmount, "Allowance after should be the approved amount");
    }

    // Test simulateAssetChange08 with invalid nonce (should revert with AA25)
    function testSimulateAssetChange08_InvalidNonce() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 0.1 ether;

        // Create call to transfer ETH
        UserOpHelper.Call memory call = UserOpHelper.Call({to: recipient, value: transferAmount, data: ""});
        bytes memory paymasterAndData = "";
        PackedUserOperation08 memory userOp = createSignedUserOp08(salt, call, paymasterAndData);

        // Fund the account
        vm.deal(userOp.sender, 1 ether);

        // Increment nonce to make it invalid
        userOp.nonce = userOp.nonce + 1;

        // Expect revert with AA25 error
        vm.expectRevert(abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA25 invalid account nonce"));
        pimlicoSim.simulateAssetChange08(
            castToVersion07(userOp),
            address(entryPointSimulations08),
            entryPoint08,
            _createBalanceQueries(ETH_ADDRESS, userOp.sender, recipient),
            _createEmptyAllowanceQueries()
        );
    }

    // ============================================
    // ============== TEST HELPERS ================
    // ============================================

    // Helper to create and fund an account
    function _setupAccountWithFunds(uint256 salt, uint256 ethAmount) private returns (address) {
        address sender06 = accountFactory06.getAddress(owner, salt);
        address sender07 = accountFactory07.getAddress(owner, salt);
        address sender08 = accountFactory08.getAddress(owner, salt);

        vm.deal(sender06, ethAmount);
        vm.deal(sender07, ethAmount);
        vm.deal(sender08, ethAmount);

        return sender06; // They should all be the same address
    }

    // Helper to mint tokens to account
    function _mintTokens(uint256 salt, uint256 token1Amount, uint256 token2Amount) private {
        // Mint to all account factory addresses as they could differ by version
        address sender06 = accountFactory06.getAddress(owner, salt);
        address sender07 = accountFactory07.getAddress(owner, salt);
        address sender08 = accountFactory08.getAddress(owner, salt);

        if (token1Amount > 0) {
            token1.mint(sender06, token1Amount);
            token1.mint(sender07, token1Amount);
            token1.mint(sender08, token1Amount);
        }
        if (token2Amount > 0) {
            token2.mint(sender06, token2Amount);
            token2.mint(sender07, token2Amount);
            token2.mint(sender08, token2Amount);
        }
    }

    // Helper to create transfer call
    function _createTransferCall(address to, uint256 value) private pure returns (UserOpHelper.Call memory) {
        return UserOpHelper.Call({to: to, value: value, data: ""});
    }

    // Helper to create token transfer call
    function _createTokenTransferCall(address token, address recipient, uint256 amount)
        private
        view
        returns (UserOpHelper.Call memory)
    {
        bytes memory data = abi.encodeWithSelector(token1.transfer.selector, recipient, amount);
        return UserOpHelper.Call({to: token, value: 0, data: data});
    }

    // Helper to create approve call
    function _createApproveCall(address token, address spender, uint256 amount)
        private
        view
        returns (UserOpHelper.Call memory)
    {
        bytes memory data = abi.encodeWithSelector(token1.approve.selector, spender, amount);
        return UserOpHelper.Call({to: token, value: 0, data: data});
    }

    // Helper to create BalanceQuery array for single owner and token
    function _createBalanceQuery(address token, address owner)
        private
        pure
        returns (PimlicoSimulations.BalanceQuery[] memory)
    {
        PimlicoSimulations.BalanceQuery[] memory queries = new PimlicoSimulations.BalanceQuery[](1);
        queries[0] = PimlicoSimulations.BalanceQuery({token: token, owner: owner});
        return queries;
    }

    // Helper to create BalanceQuery array for multiple owners with same token
    function _createBalanceQueries(address token, address owner1, address owner2)
        private
        pure
        returns (PimlicoSimulations.BalanceQuery[] memory)
    {
        PimlicoSimulations.BalanceQuery[] memory queries = new PimlicoSimulations.BalanceQuery[](2);
        queries[0] = PimlicoSimulations.BalanceQuery({token: token, owner: owner1});
        queries[1] = PimlicoSimulations.BalanceQuery({token: token, owner: owner2});
        return queries;
    }

    // Helper to create BalanceQuery array for multiple tokens and owners
    function _createBalanceQueries(address[] memory tokens, address[] memory owners)
        private
        pure
        returns (PimlicoSimulations.BalanceQuery[] memory)
    {
        uint256 totalQueries = tokens.length * owners.length;
        PimlicoSimulations.BalanceQuery[] memory queries = new PimlicoSimulations.BalanceQuery[](totalQueries);
        uint256 index = 0;
        for (uint256 i = 0; i < tokens.length; i++) {
            for (uint256 j = 0; j < owners.length; j++) {
                queries[index++] = PimlicoSimulations.BalanceQuery({token: tokens[i], owner: owners[j]});
            }
        }
        return queries;
    }

    // Helper to create AllowanceQuery array for single query
    function _createAllowanceQuery(address token, address owner, address spender)
        private
        pure
        returns (PimlicoSimulations.AllowanceQuery[] memory)
    {
        PimlicoSimulations.AllowanceQuery[] memory queries = new PimlicoSimulations.AllowanceQuery[](1);
        queries[0] = PimlicoSimulations.AllowanceQuery({token: token, owner: owner, spender: spender});
        return queries;
    }

    // Helper to create empty AllowanceQuery array
    function _createEmptyAllowanceQueries() private pure returns (PimlicoSimulations.AllowanceQuery[] memory) {
        return new PimlicoSimulations.AllowanceQuery[](0);
    }

    // Helper to create owners array
    function _createOwners(address owner1) private pure returns (address[] memory) {
        address[] memory owners = new address[](1);
        owners[0] = owner1;
        return owners;
    }

    // Helper to create owners array with 2 addresses
    function _createOwners(address owner1, address owner2) private pure returns (address[] memory) {
        address[] memory owners = new address[](2);
        owners[0] = owner1;
        owners[1] = owner2;
        return owners;
    }

    // Helper to create tokens array
    function _createTokens(address tokenAddr) private pure returns (address[] memory) {
        address[] memory tokens = new address[](1);
        tokens[0] = tokenAddr;
        return tokens;
    }

    // Helper to create tokens array with 2 tokens
    function _createTokens(address tokenAddr1, address tokenAddr2) private pure returns (address[] memory) {
        address[] memory tokens = new address[](2);
        tokens[0] = tokenAddr1;
        tokens[1] = tokenAddr2;
        return tokens;
    }

    // Helper to verify balance change
    function _verifyBalanceChange(
        PimlicoSimulations.BalanceChange memory change,
        address expectedAddr,
        address expectedToken,
        uint256 expectedBefore,
        uint256 expectedAfter
    ) private {
        assertEq(change.owner, expectedAddr, "Address mismatch");
        assertEq(change.token, expectedToken, "Token mismatch");
        assertEq(change.balanceBefore, expectedBefore, "Balance before mismatch");
        assertEq(change.balanceAfter, expectedAfter, "Balance after mismatch");
    }

    // Helper to verify allowance change
    function _verifyAllowanceChange(
        PimlicoSimulations.AllowanceChange memory change,
        address expectedOwner,
        address expectedToken,
        address expectedSpender,
        uint256 expectedBefore,
        uint256 expectedAfter
    ) private {
        assertEq(change.owner, expectedOwner, "Owner mismatch");
        assertEq(change.token, expectedToken, "Token mismatch");
        assertEq(change.spender, expectedSpender, "Spender mismatch");
        assertEq(change.allowanceBefore, expectedBefore, "Allowance before mismatch");
        assertEq(change.allowanceAfter, expectedAfter, "Allowance after mismatch");
    }
}
