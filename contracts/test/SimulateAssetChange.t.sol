// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/PimlicoSimulations.sol";

import {UserOpHelper} from "./utils/UserOpHelper.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";

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

contract SimulateAssetChangeTest is UserOpHelper {
//PimlicoSimulations pimlicoSim;

//// Accounts
//SimpleAccount06 account06;
//SimpleAccount07 account07;

//// EntryPoint v0.7 simulations
//EntryPointSimulations07 entryPointSimulations07;

//// Mock tokens
//ERC20Mock tokenA;
//ERC20Mock tokenB;

//// Test addresses
//address payable beneficiary = payable(address(0x1234));
//address owner;
//address receiver = address(0x5678);

//// Native token address constant
//address constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

//function setUp() public {
//    // Setup EntryPoints, factories and owner key from UserOpHelper
//    setupTestEnvironment("owner");
//
//    // Get owner address from the key
//    (owner, ) = makeAddrAndKey("owner");

//    // Deploy PimlicoSimulations
//    pimlicoSim = new PimlicoSimulations();

//    // Deploy mock tokens
//    tokenA = new ERC20Mock();
//    tokenB = new ERC20Mock();

//    // Create accounts
//    account06 = accountFactory06.createAccount(owner, 0);
//    account07 = accountFactory07.createAccount(owner, 0);
//
//    // Setup v0.7 simulations
//    entryPointSimulations07 = new EntryPointSimulations07();

//    // Fund accounts
//    vm.deal(address(account06), 10 ether);
//    vm.deal(address(account07), 10 ether);

//    // Mint tokens to accounts
//    tokenA.mint(address(account06), 1000e18);
//    tokenA.mint(address(account07), 1000e18);
//    tokenB.mint(address(account06), 2000e18);
//    tokenB.mint(address(account07), 2000e18);
//}

//function testGetBalances() public {
//    address[] memory addresses = new address[](2);
//    addresses[0] = address(account06);
//    addresses[1] = receiver;

//    address[] memory tokens = new address[](3);
//    tokens[0] = NATIVE_TOKEN;
//    tokens[1] = address(tokenA);
//    tokens[2] = address(tokenB);

//    PimlicoSimulations.AssetBalance[] memory balances = pimlicoSim.getBalances(addresses, tokens);

//    // Should return 2 addresses * 3 tokens = 6 balances
//    assertEq(balances.length, 6);

//    // Check account06 balances
//    assertEq(balances[0].owner, address(account06));
//    assertEq(balances[0].token, NATIVE_TOKEN);
//    assertEq(balances[0].amount, 10 ether);

//    assertEq(balances[1].owner, address(account06));
//    assertEq(balances[1].token, address(tokenA));
//    assertEq(balances[1].amount, 1000e18);

//    assertEq(balances[2].owner, address(account06));
//    assertEq(balances[2].token, address(tokenB));
//    assertEq(balances[2].amount, 2000e18);

//    // Check receiver balances (should all be 0)
//    assertEq(balances[3].owner, receiver);
//    assertEq(balances[3].token, NATIVE_TOKEN);
//    assertEq(balances[3].amount, 0);

//    assertEq(balances[4].owner, receiver);
//    assertEq(balances[4].token, address(tokenA));
//    assertEq(balances[4].amount, 0);

//    assertEq(balances[5].owner, receiver);
//    assertEq(balances[5].token, address(tokenB));
//    assertEq(balances[5].amount, 0);
//}

//function testSimulateAssetChange06_NativeTransfer() public {
//    // Create a simple ETH transfer operation
//    bytes memory callData = abi.encodeWithSignature("execute(address,uint256,bytes)", receiver, 1 ether, "");

//    UserOperation06 memory userOp = _createSignedUserOp06(
//        address(account06),
//        0, // nonce
//        callData
//    );

//    address[] memory addresses = new address[](2);
//    addresses[0] = address(account06);
//    addresses[1] = receiver;

//    address[] memory tokens = new address[](1);
//    tokens[0] = NATIVE_TOKEN;

//    PimlicoSimulations.AssetChange[] memory changes =
//        pimlicoSim.simulateAssetChange06(userOp, entryPoint06, addresses, tokens);

//    assertEq(changes.length, 2);

//    // Account06 should lose 1 ETH + gas
//    assertEq(changes[0].owner, address(account06));
//    assertEq(changes[0].token, NATIVE_TOKEN);
//    assertTrue(changes[0].diff < -1 ether); // Lost more than 1 ETH due to gas

//    // Receiver should gain 1 ETH
//    assertEq(changes[1].owner, receiver);
//    assertEq(changes[1].token, NATIVE_TOKEN);
//    assertEq(changes[1].diff, 1 ether);
//}

//function testSimulateAssetChange06_TokenTransfer() public {
//    // Create an ERC20 transfer operation
//    bytes memory transferData = abi.encodeWithSignature("transfer(address,uint256)", receiver, 100e18);
//    bytes memory callData =
//        abi.encodeWithSignature("execute(address,uint256,bytes)", address(tokenA), 0, transferData);

//    UserOperation06 memory userOp = _createSignedUserOp06(
//        address(account06),
//        0, // nonce
//        callData
//    );

//    address[] memory addresses = new address[](2);
//    addresses[0] = address(account06);
//    addresses[1] = receiver;

//    address[] memory tokens = new address[](2);
//    tokens[0] = NATIVE_TOKEN;
//    tokens[1] = address(tokenA);

//    PimlicoSimulations.AssetChange[] memory changes =
//        pimlicoSim.simulateAssetChange06(userOp, entryPoint06, addresses, tokens);

//    assertEq(changes.length, 4);

//    // Check ETH changes (only gas for account06)
//    assertEq(changes[0].owner, address(account06));
//    assertEq(changes[0].token, NATIVE_TOKEN);
//    assertTrue(changes[0].diff < 0); // Lost gas

//    assertEq(changes[1].owner, receiver);
//    assertEq(changes[1].token, NATIVE_TOKEN);
//    assertEq(changes[1].diff, 0); // No ETH change for receiver

//    // Check token changes
//    assertEq(changes[2].owner, address(account06));
//    assertEq(changes[2].token, address(tokenA));
//    assertEq(changes[2].diff, -100e18); // Lost 100 tokens

//    assertEq(changes[3].owner, receiver);
//    assertEq(changes[3].token, address(tokenA));
//    assertEq(changes[3].diff, 100e18); // Gained 100 tokens
//}

//function testSimulateAssetChange07_TokenTransfer() public {
//    // Create an ERC20 transfer operation for v0.7
//    bytes memory transferData = abi.encodeWithSignature("transfer(address,uint256)", receiver, 50e18);
//    bytes memory callData =
//        abi.encodeWithSignature("execute(address,uint256,bytes)", address(tokenB), 0, transferData);

//    PackedUserOperation07 memory userOp = _createSignedUserOp07(
//        address(account07),
//        0, // nonce
//        callData
//    );

//    address[] memory addresses = new address[](2);
//    addresses[0] = address(account07);
//    addresses[1] = receiver;

//    address[] memory tokens = new address[](1);
//    tokens[0] = address(tokenB);

//    PimlicoSimulations.AssetChange[] memory changes =
//        pimlicoSim.simulateAssetChange07(userOp, entryPoint07, address(entryPointSimulations07), addresses, tokens);

//    assertEq(changes.length, 2);

//    // Check token changes
//    assertEq(changes[0].owner, address(account07));
//    assertEq(changes[0].token, address(tokenB));
//    assertEq(changes[0].diff, -50e18); // Lost 50 tokens

//    assertEq(changes[1].owner, receiver);
//    assertEq(changes[1].token, address(tokenB));
//    assertEq(changes[1].diff, 50e18); // Gained 50 tokens
//}

//// Helper functions
//function _createSignedUserOp06(address sender, uint256 nonce, bytes memory callData)
//    internal
//    view
//    returns (UserOperation06 memory)
//{
//    return createSignedUserOp06Raw(sender, nonce, "", callData, address(0));
//}

//function _createSignedUserOp07(address sender, uint256 nonce, bytes memory callData)
//    internal
//    view
//    returns (PackedUserOperation07 memory)
//{
//    return createSignedUserOp07Raw(sender, nonce, "", callData, "");
//}
}
