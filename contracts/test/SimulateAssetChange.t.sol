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

        // Create call to transfer ETH
        UserOpHelper.Call memory call = UserOpHelper.Call({to: recipient, value: transferAmount, data: ""});
        bytes memory paymasterAndData = "";
        UserOperation06 memory userOp = createSignedUserOp06(salt, call, paymasterAndData);

        // Fund the account
        vm.deal(userOp.sender, 1 ether);

        // Record balances before simulation
        uint256 senderBalanceBeforeSim = userOp.sender.balance;
        uint256 recipientBalanceBeforeSim = recipient.balance;

        // Track owners
        address[] memory owners = new address[](2);
        owners[0] = userOp.sender;
        owners[1] = recipient;

        address[] memory tokens = new address[](1);
        tokens[0] = ETH_ADDRESS;

        // Simulate asset changes
        PimlicoSimulations.AssetChange[] memory changes =
            pimlicoSim.simulateAssetChange06(userOp, entryPoint06, owners, tokens);

        // Verify results
        assertEq(changes.length, 2, "Should have 2 ETH balance changes");

        // Verify sender's balances
        assertEq(changes[0].addr, userOp.sender);
        assertEq(changes[0].token, ETH_ADDRESS);
        assertEq(changes[0].balanceBefore, senderBalanceBeforeSim, "Sender balanceBefore should match current balance");
        assertLt(changes[0].balanceAfter, changes[0].balanceBefore, "Sender balance should decrease");
        assertLt(changes[0].balanceAfter, senderBalanceBeforeSim - transferAmount, "Sender should pay transfer + gas");

        // Verify recipient's balances
        assertEq(changes[1].addr, recipient);
        assertEq(changes[1].token, ETH_ADDRESS);
        assertEq(
            changes[1].balanceBefore, recipientBalanceBeforeSim, "Recipient balanceBefore should match current balance"
        );
        assertEq(
            changes[1].balanceAfter,
            recipientBalanceBeforeSim + transferAmount,
            "Recipient should receive exact transfer amount"
        );
    }

    // Test simulateAssetChange06 with ERC20 token transfer
    function testSimulateAssetChange06_TokenTransfer() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 100e18;

        // Mint tokens to the account that will be created
        address sender = accountFactory06.getAddress(owner, salt);
        token1.mint(sender, 1000e18);

        // Create call to transfer tokens
        bytes memory transferData = abi.encodeWithSelector(token1.transfer.selector, recipient, transferAmount);
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(token1), value: 0, data: transferData});
        bytes memory paymasterAndData = "";
        UserOperation06 memory userOp = createSignedUserOp06(salt, call, paymasterAndData);

        // Fund the account for gas
        vm.deal(userOp.sender, 1 ether);

        // Record token balances before simulation
        uint256 senderTokenBalanceBeforeSim = token1.balanceOf(userOp.sender);
        uint256 recipientTokenBalanceBeforeSim = token1.balanceOf(recipient);

        // Track owners and tokens
        address[] memory owners = new address[](2);
        owners[0] = userOp.sender;
        owners[1] = recipient;

        address[] memory tokens = new address[](1);
        tokens[0] = address(token1);

        // Simulate asset changes
        PimlicoSimulations.AssetChange[] memory changes =
            pimlicoSim.simulateAssetChange06(userOp, entryPoint06, owners, tokens);

        // Verify results - should have 2 token changes
        assertEq(changes.length, 2, "Should have 2 token changes");

        // Verify sender's token balances
        assertEq(changes[0].addr, userOp.sender);
        assertEq(changes[0].token, address(token1));
        assertEq(
            changes[0].balanceBefore,
            senderTokenBalanceBeforeSim,
            "Sender token balanceBefore should match actual balance"
        );
        assertEq(
            changes[0].balanceAfter,
            senderTokenBalanceBeforeSim - transferAmount,
            "Sender should have initial balance minus transfer"
        );

        // Verify recipient's token balances
        assertEq(changes[1].addr, recipient);
        assertEq(changes[1].token, address(token1));
        assertEq(
            changes[1].balanceBefore,
            recipientTokenBalanceBeforeSim,
            "Recipient token balanceBefore should match actual balance"
        );
        assertEq(
            changes[1].balanceAfter,
            recipientTokenBalanceBeforeSim + transferAmount,
            "Recipient should have initial balance plus transfer"
        );
    }

    // Test simulateAssetChange06 with multiple asset changes (ETH + tokens)
    function testSimulateAssetChange06_MultipleAssets() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 ethAmount = 0.1 ether;
        uint256 token1Amount = 50e18;
        uint256 token2Amount = 75e18;

        // Mint tokens to the account that will be created
        address sender = accountFactory06.getAddress(owner, salt);
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
        UserOperation06 memory userOp = createSignedUserOp06(salt, calls, paymasterAndData);

        // Fund the account for gas and ETH transfer
        vm.deal(userOp.sender, 1 ether);

        // Track owners and tokens
        address[] memory owners = new address[](2);
        owners[0] = userOp.sender;
        owners[1] = recipient;

        address[] memory tokens = new address[](2);
        tokens[0] = address(token1);
        tokens[1] = address(token2);

        // Simulate asset changes
        PimlicoSimulations.AssetChange[] memory changes =
            pimlicoSim.simulateAssetChange06(userOp, entryPoint06, owners, tokens);

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

    // Test simulateAssetChange06 with no changes
    function testSimulateAssetChange06_NoChanges() public {
        uint256 salt = 0;

        // Create a no-op call
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        bytes memory paymasterAndData = "";
        UserOperation06 memory userOp = createSignedUserOp06(salt, call, paymasterAndData);

        // Fund the account
        vm.deal(userOp.sender, 1 ether);

        // Record balance before simulation
        uint256 senderBalanceBeforeSim = userOp.sender.balance;

        // Track only the sender
        address[] memory owners = new address[](1);
        owners[0] = userOp.sender;

        address[] memory tokens = new address[](1);
        tokens[0] = ETH_ADDRESS;

        // Simulate asset changes
        PimlicoSimulations.AssetChange[] memory changes =
            pimlicoSim.simulateAssetChange06(userOp, entryPoint06, owners, tokens);

        // Should only have gas cost change
        assertEq(changes.length, 1, "Should only have 1 change for gas");
        assertEq(changes[0].addr, userOp.sender);
        assertEq(changes[0].token, ETH_ADDRESS);
        assertEq(changes[0].balanceBefore, senderBalanceBeforeSim, "balanceBefore should match current balance");
        assertLt(changes[0].balanceAfter, changes[0].balanceBefore, "ETH should decrease due to gas");
    }

    // Test simulateAssetChange06 with invalid nonce (should revert with AA25)
    function testSimulateAssetChange06_InvalidNonce() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 0.1 ether;

        // Create call to transfer ETH
        UserOpHelper.Call memory call = UserOpHelper.Call({to: recipient, value: transferAmount, data: ""});
        bytes memory paymasterAndData = "";
        UserOperation06 memory userOp = createSignedUserOp06(salt, call, paymasterAndData);

        // Fund the account
        vm.deal(userOp.sender, 1 ether);

        // Increment nonce to make it invalid
        userOp.nonce = userOp.nonce + 1;

        // Track owners
        address[] memory owners = new address[](2);
        owners[0] = userOp.sender;
        owners[1] = recipient;

        address[] memory tokens = new address[](1);
        tokens[0] = ETH_ADDRESS;

        // Expect revert with AA25 error
        vm.expectRevert(abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA25 invalid account nonce"));
        pimlicoSim.simulateAssetChange06(userOp, entryPoint06, owners, tokens);
    }

    // ============================================
    // =========== ENTRYPOINT 07 TESTS ============
    // ============================================

    // Test simulateAssetChange07 with ETH transfer
    function testSimulateAssetChange07_ETHTransfer() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 0.5 ether;

        // Create call to transfer ETH
        UserOpHelper.Call memory call = UserOpHelper.Call({to: recipient, value: transferAmount, data: ""});
        bytes memory paymasterAndData = "";
        PackedUserOperation07 memory userOp = createSignedUserOp07(salt, call, paymasterAndData);

        // Fund the account
        vm.deal(userOp.sender, 1 ether);

        // Record balances before simulation
        uint256 senderBalanceBeforeSim = userOp.sender.balance;
        uint256 recipientBalanceBeforeSim = recipient.balance;

        // Track owners
        address[] memory owners = new address[](2);
        owners[0] = userOp.sender;
        owners[1] = recipient;

        address[] memory tokens = new address[](1);
        tokens[0] = ETH_ADDRESS;

        // Simulate asset changes
        PimlicoSimulations.AssetChange[] memory changes =
            pimlicoSim.simulateAssetChange07(userOp, entryPoint07, address(entryPointSimulations07), owners, tokens);

        // Verify results
        assertEq(changes.length, 2, "Should have 2 ETH balance changes");

        // Verify ETH changes
        for (uint256 i = 0; i < changes.length; i++) {
            assertEq(changes[i].token, ETH_ADDRESS, "All changes should be ETH");
            if (changes[i].addr == userOp.sender) {
                assertEq(changes[i].balanceBefore, senderBalanceBeforeSim, "Sender balanceBefore should match");
                assertLt(changes[i].balanceAfter, changes[i].balanceBefore, "Sender ETH should decrease");
                assertLt(changes[i].balanceAfter, senderBalanceBeforeSim - transferAmount, "Should include gas");
            } else if (changes[i].addr == recipient) {
                assertEq(changes[i].balanceBefore, recipientBalanceBeforeSim, "Recipient balanceBefore should match");
                assertEq(
                    changes[i].balanceAfter,
                    recipientBalanceBeforeSim + transferAmount,
                    "Recipient should receive exact amount"
                );
            }
        }
    }

    // Test simulateAssetChange07 with token transfer
    function testSimulateAssetChange07_TokenTransfer() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 100e18;

        // Mint tokens to the account that will be created
        address sender = accountFactory07.getAddress(owner, salt);
        token1.mint(sender, 1000e18);

        // Create call to transfer tokens
        bytes memory transferData = abi.encodeWithSelector(token1.transfer.selector, recipient, transferAmount);
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(token1), value: 0, data: transferData});
        bytes memory paymasterAndData = "";
        PackedUserOperation07 memory userOp = createSignedUserOp07(salt, call, paymasterAndData);

        // Fund the account for gas
        vm.deal(userOp.sender, 1 ether);

        // Record token balances before simulation
        uint256 senderTokenBalanceBeforeSim = token1.balanceOf(userOp.sender);
        uint256 recipientTokenBalanceBeforeSim = token1.balanceOf(recipient);

        // Track owners and tokens
        address[] memory owners = new address[](2);
        owners[0] = userOp.sender;
        owners[1] = recipient;

        address[] memory tokens = new address[](1);
        tokens[0] = address(token1);

        // Simulate asset changes
        PimlicoSimulations.AssetChange[] memory changes =
            pimlicoSim.simulateAssetChange07(userOp, entryPoint07, address(entryPointSimulations07), owners, tokens);

        // Verify results
        assertEq(changes.length, 2, "Should have 2 token changes");

        // Verify token changes
        for (uint256 i = 0; i < changes.length; i++) {
            assertEq(changes[i].token, address(token1), "All changes should be for token1");
            if (changes[i].addr == userOp.sender) {
                assertEq(changes[i].balanceBefore, senderTokenBalanceBeforeSim, "Sender balanceBefore should match");
                assertEq(
                    changes[i].balanceAfter,
                    senderTokenBalanceBeforeSim - transferAmount,
                    "Sender tokens should decrease"
                );
            } else if (changes[i].addr == recipient) {
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

    // Test simulateAssetChange07 with multiple asset changes (ETH + tokens)
    function testSimulateAssetChange07_MultipleAssets() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 ethAmount = 0.1 ether;
        uint256 token1Amount = 50e18;
        uint256 token2Amount = 75e18;

        // Mint tokens to the account that will be created
        address sender = accountFactory07.getAddress(owner, salt);
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
        PackedUserOperation07 memory userOp = createSignedUserOp07(salt, calls, paymasterAndData);

        // Fund the account for gas and ETH transfer
        vm.deal(userOp.sender, 1 ether);

        // Track owners and tokens
        address[] memory owners = new address[](2);
        owners[0] = userOp.sender;
        owners[1] = recipient;

        address[] memory tokens = new address[](2);
        tokens[0] = address(token1);
        tokens[1] = address(token2);

        // Simulate asset changes
        PimlicoSimulations.AssetChange[] memory changes =
            pimlicoSim.simulateAssetChange07(userOp, entryPoint07, address(entryPointSimulations07), owners, tokens);

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

    // Test simulateAssetChange07 with no changes
    function testSimulateAssetChange07_NoChanges() public {
        uint256 salt = 0;

        // Create a no-op call
        UserOpHelper.Call memory call = UserOpHelper.Call({to: address(0), value: 0, data: ""});
        bytes memory paymasterAndData = "";
        PackedUserOperation07 memory userOp = createSignedUserOp07(salt, call, paymasterAndData);

        // Fund the account
        vm.deal(userOp.sender, 1 ether);

        // Record balance before simulation
        uint256 senderBalanceBeforeSim = userOp.sender.balance;

        // Track only the sender
        address[] memory owners = new address[](1);
        owners[0] = userOp.sender;

        address[] memory tokens = new address[](1);
        tokens[0] = ETH_ADDRESS;

        // Simulate asset changes
        PimlicoSimulations.AssetChange[] memory changes =
            pimlicoSim.simulateAssetChange07(userOp, entryPoint07, address(entryPointSimulations07), owners, tokens);

        // Should only have gas cost change
        assertEq(changes.length, 1, "Should only have 1 change for gas");
        assertEq(changes[0].addr, userOp.sender);
        assertEq(changes[0].token, ETH_ADDRESS);
        assertEq(changes[0].balanceBefore, senderBalanceBeforeSim, "balanceBefore should match current balance");
        assertLt(changes[0].balanceAfter, changes[0].balanceBefore, "ETH should decrease due to gas");
    }

    // Test simulateAssetChange07 with invalid nonce (should revert with AA25)
    function testSimulateAssetChange07_InvalidNonce() public {
        uint256 salt = 0;
        address recipient = address(0x1234);
        uint256 transferAmount = 0.1 ether;

        // Create call to transfer ETH
        UserOpHelper.Call memory call = UserOpHelper.Call({to: recipient, value: transferAmount, data: ""});
        bytes memory paymasterAndData = "";
        PackedUserOperation07 memory userOp = createSignedUserOp07(salt, call, paymasterAndData);

        // Fund the account
        vm.deal(userOp.sender, 1 ether);

        // Increment nonce to make it invalid
        userOp.nonce = userOp.nonce + 1;

        // Track owners
        address[] memory owners = new address[](2);
        owners[0] = userOp.sender;
        owners[1] = recipient;

        address[] memory tokens = new address[](1);
        tokens[0] = ETH_ADDRESS;

        // Expect revert with AA25 error
        vm.expectRevert(abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA25 invalid account nonce"));
        pimlicoSim.simulateAssetChange07(userOp, entryPoint07, address(entryPointSimulations07), owners, tokens);
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

        // Track owners
        address[] memory owners = new address[](2);
        owners[0] = userOp.sender;
        owners[1] = recipient;

        address[] memory tokens = new address[](1);
        tokens[0] = ETH_ADDRESS;

        // Simulate asset changes (v0.8 uses v0.7 format)
        PimlicoSimulations.AssetChange[] memory changes = pimlicoSim.simulateAssetChange08(
            castToVersion07(userOp), entryPoint08, address(entryPointSimulations08), owners, tokens
        );

        // Verify results
        assertEq(changes.length, 2, "Should have 2 ETH balance changes");

        // Verify ETH changes
        for (uint256 i = 0; i < changes.length; i++) {
            assertEq(changes[i].token, ETH_ADDRESS, "All changes should be ETH");
            if (changes[i].addr == userOp.sender) {
                assertEq(changes[i].balanceBefore, senderBalanceBeforeSim, "Sender balanceBefore should match");
                assertLt(changes[i].balanceAfter, changes[i].balanceBefore, "Sender ETH should decrease");
                assertLt(changes[i].balanceAfter, senderBalanceBeforeSim - transferAmount, "Should include gas");
            } else if (changes[i].addr == recipient) {
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

        // Track owners and tokens
        address[] memory owners = new address[](2);
        owners[0] = userOp.sender;
        owners[1] = recipient;

        address[] memory tokens = new address[](1);
        tokens[0] = address(token1);

        // Simulate asset changes
        PimlicoSimulations.AssetChange[] memory changes = pimlicoSim.simulateAssetChange08(
            castToVersion07(userOp), entryPoint08, address(entryPointSimulations08), owners, tokens
        );

        // Verify results
        assertEq(changes.length, 2, "Should have 2 token changes");

        // Verify token changes
        for (uint256 i = 0; i < changes.length; i++) {
            assertEq(changes[i].token, address(token1), "All changes should be for token1");
            if (changes[i].addr == userOp.sender) {
                assertEq(changes[i].balanceBefore, senderTokenBalanceBeforeSim, "Sender balanceBefore should match");
                assertEq(
                    changes[i].balanceAfter,
                    senderTokenBalanceBeforeSim - transferAmount,
                    "Sender tokens should decrease"
                );
            } else if (changes[i].addr == recipient) {
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

        // Track owners and tokens
        address[] memory owners = new address[](2);
        owners[0] = userOp.sender;
        owners[1] = recipient;

        address[] memory tokens = new address[](2);
        tokens[0] = address(token1);
        tokens[1] = address(token2);

        // Simulate asset changes
        PimlicoSimulations.AssetChange[] memory changes = pimlicoSim.simulateAssetChange08(
            castToVersion07(userOp), entryPoint08, address(entryPointSimulations08), owners, tokens
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

        // Track only the sender
        address[] memory owners = new address[](1);
        owners[0] = userOp.sender;

        address[] memory tokens = new address[](1);
        tokens[0] = ETH_ADDRESS;

        // Simulate asset changes
        PimlicoSimulations.AssetChange[] memory changes = pimlicoSim.simulateAssetChange08(
            castToVersion07(userOp), entryPoint08, address(entryPointSimulations08), owners, tokens
        );

        // Should only have gas cost change
        assertEq(changes.length, 1, "Should only have 1 change for gas");
        assertEq(changes[0].addr, userOp.sender);
        assertEq(changes[0].token, ETH_ADDRESS);
        assertEq(changes[0].balanceBefore, senderBalanceBeforeSim, "balanceBefore should match current balance");
        assertLt(changes[0].balanceAfter, changes[0].balanceBefore, "ETH should decrease due to gas");
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

        // Track owners
        address[] memory owners = new address[](2);
        owners[0] = userOp.sender;
        owners[1] = recipient;

        address[] memory tokens = new address[](1);
        tokens[0] = ETH_ADDRESS;

        // Expect revert with AA25 error
        vm.expectRevert(abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA25 invalid account nonce"));
        pimlicoSim.simulateAssetChange08(
            castToVersion07(userOp), entryPoint08, address(entryPointSimulations08), owners, tokens
        );
    }

    // ============================================
    // ============== TEST HELPERS ================
    // ============================================

    function _assertAssetChange(
        PimlicoSimulations.AssetChange memory change,
        address expectedOwner,
        address expectedToken,
        uint256 expectedBalanceBefore,
        uint256 expectedBalanceAfter,
        string memory message
    ) private {
        assertEq(change.addr, expectedOwner, string.concat(message, ": account mismatch"));
        assertEq(change.token, expectedToken, string.concat(message, ": token mismatch"));
        assertEq(change.balanceBefore, expectedBalanceBefore, string.concat(message, ": balanceBefore mismatch"));
        assertEq(change.balanceAfter, expectedBalanceAfter, string.concat(message, ": balanceAfter mismatch"));
    }

    function _findAssetChange(PimlicoSimulations.AssetChange[] memory changes, address owner, address token)
        private
        pure
        returns (bool found, uint256 index)
    {
        for (uint256 i = 0; i < changes.length; i++) {
            if (changes[i].addr == owner && changes[i].token == token) {
                return (true, i);
            }
        }
        return (false, 0);
    }
}
