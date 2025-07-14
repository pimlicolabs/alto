// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin-v4.8.3/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "openzeppelin-contracts-v5.0.2/contracts/utils/cryptography/MessageHashUtils.sol";

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
import {BaseAccount as SimpleAccount08} from "@test-aa-utils/v08/accounts/SimpleAccount.sol";

contract UserOpHelper is Test {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Struct for call parameters
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    // EntryPoint instances
    EntryPoint06 public entryPoint06;
    EntryPoint07 public entryPoint07;
    EntryPoint08 public entryPoint08;

    // Account factory instances
    SimpleAccountFactory06 public accountFactory06;
    SimpleAccountFactory07 public accountFactory07;
    SimpleAccountFactory08 public accountFactory08;

    // Owner key for signing operations
    uint256 public ownerKey;
    address public owner;

    function setupTestEnvironment(string memory keyName) internal {
        // Setup EntryPoints
        entryPoint06 = new EntryPoint06();
        entryPoint07 = new EntryPoint07();
        entryPoint08 = new EntryPoint08();

        // Setup factories
        accountFactory06 = new SimpleAccountFactory06(entryPoint06);
        accountFactory07 = new SimpleAccountFactory07(entryPoint07);
        accountFactory08 = new SimpleAccountFactory08(entryPoint08);

        // Setup owner key and address
        (owner, ownerKey) = makeAddrAndKey(keyName);
    }

    // Create and sign UserOperation for EntryPoint v0.6
    function createSignedUserOp06(uint256 salt, Call memory call, bytes memory paymasterAndData)
        internal
        view
        returns (UserOperation06 memory)
    {
        // Derive sender address
        address sender = accountFactory06.getAddress(owner, salt);

        // Get nonce from EntryPoint
        uint256 nonce = entryPoint06.getNonce(sender, 0);

        // Check if account needs to be deployed
        bytes memory initCode = "";
        if (sender.code.length == 0) {
            initCode = abi.encodePacked(
                address(accountFactory06), abi.encodeCall(accountFactory06.createAccount, (owner, salt))
            );
        }

        // Encode the execute call
        bytes memory callData = abi.encodeWithSelector(SimpleAccount06.execute.selector, call.to, call.value, call.data);

        UserOperation06 memory userOp = UserOperation06({
            sender: sender,
            nonce: nonce,
            initCode: initCode,
            callData: callData,
            callGasLimit: 200000,
            verificationGasLimit: 300000,
            preVerificationGas: 21000,
            maxFeePerGas: 1 gwei,
            maxPriorityFeePerGas: 1 gwei,
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        bytes32 hash = entryPoint06.getUserOpHash(userOp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, MessageHashUtils.toEthSignedMessageHash(hash));
        userOp.signature = abi.encodePacked(r, s, v);

        return userOp;
    }

    // Create and sign UserOperation for EntryPoint v0.6 with batch calls
    function createSignedUserOp06(uint256 salt, Call[] memory calls, bytes memory paymasterAndData)
        internal
        view
        returns (UserOperation06 memory)
    {
        // Derive sender address
        address sender = accountFactory06.getAddress(owner, salt);

        // Get nonce from EntryPoint
        uint256 nonce = entryPoint06.getNonce(sender, 0);

        // Check if account needs to be deployed
        bytes memory initCode = "";
        if (sender.code.length == 0) {
            initCode = abi.encodePacked(
                address(accountFactory06), abi.encodeCall(accountFactory06.createAccount, (owner, salt))
            );
        }

        // Prepare arrays for batch execution
        address[] memory targets = new address[](calls.length);
        bytes[] memory datas = new bytes[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            targets[i] = calls[i].to;
            // For v0.6, we need to encode value into the calldata if needed
            if (calls[i].value > 0) {
                // If there's a value, we need to use the execute function instead
                datas[i] =
                    abi.encodeWithSelector(SimpleAccount06.execute.selector, calls[i].to, calls[i].value, calls[i].data);
                targets[i] = sender; // Call back to the account itself
            } else {
                datas[i] = calls[i].data;
            }
        }

        // Encode the executeBatch call (v0.6 only takes dest and func arrays)
        bytes memory callData = abi.encodeWithSelector(SimpleAccount06.executeBatch.selector, targets, datas);

        UserOperation06 memory userOp = UserOperation06({
            sender: sender,
            nonce: nonce,
            initCode: initCode,
            callData: callData,
            callGasLimit: 200000,
            verificationGasLimit: 300000,
            preVerificationGas: 21000,
            maxFeePerGas: 1 gwei,
            maxPriorityFeePerGas: 1 gwei,
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        bytes32 hash = entryPoint06.getUserOpHash(userOp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, MessageHashUtils.toEthSignedMessageHash(hash));
        userOp.signature = abi.encodePacked(r, s, v);

        return userOp;
    }

    // Create and sign PackedUserOperation for EntryPoint v0.7
    function createSignedUserOp07(uint256 salt, Call memory call, bytes memory paymasterAndData)
        internal
        view
        returns (PackedUserOperation07 memory)
    {
        // Derive sender address
        address sender = accountFactory07.getAddress(owner, salt);

        // Get nonce from EntryPoint
        uint256 nonce = entryPoint07.getNonce(sender, 0);

        // Check if account needs to be deployed
        bytes memory initCode = "";
        if (sender.code.length == 0) {
            initCode = abi.encodePacked(
                address(accountFactory07), abi.encodeCall(accountFactory07.createAccount, (owner, salt))
            );
        }

        PackedUserOperation07 memory userOp = PackedUserOperation07({
            sender: sender,
            nonce: nonce,
            initCode: initCode,
            callData: abi.encodeWithSelector(SimpleAccount07.execute.selector, call.to, call.value, call.data),
            accountGasLimits: packGasLimits(300000, 200000),
            preVerificationGas: 21000,
            gasFees: packGasFees(1 gwei, 1 gwei),
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        bytes32 hash = entryPoint07.getUserOpHash(userOp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, MessageHashUtils.toEthSignedMessageHash(hash));
        userOp.signature = abi.encodePacked(r, s, v);

        return userOp;
    }

    // Create and sign PackedUserOperation for EntryPoint v0.7 with batch calls
    function createSignedUserOp07(uint256 salt, Call[] memory calls, bytes memory paymasterAndData)
        internal
        view
        returns (PackedUserOperation07 memory)
    {
        // Derive sender address
        address sender = accountFactory07.getAddress(owner, salt);

        // Get nonce from EntryPoint
        uint256 nonce = entryPoint07.getNonce(sender, 0);

        // Check if account needs to be deployed
        bytes memory initCode = "";
        if (sender.code.length == 0) {
            initCode = abi.encodePacked(
                address(accountFactory07), abi.encodeCall(accountFactory07.createAccount, (owner, salt))
            );
        }

        // Prepare arrays for batch execution
        address[] memory targets = new address[](calls.length);
        uint256[] memory values = new uint256[](calls.length);
        bytes[] memory datas = new bytes[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            targets[i] = calls[i].to;
            values[i] = calls[i].value;
            datas[i] = calls[i].data;
        }

        // Encode the executeBatch call
        bytes memory callData = abi.encodeWithSelector(SimpleAccount07.executeBatch.selector, targets, values, datas);

        PackedUserOperation07 memory userOp = PackedUserOperation07({
            sender: sender,
            nonce: nonce,
            initCode: initCode,
            callData: callData,
            accountGasLimits: packGasLimits(300000, 200000),
            preVerificationGas: 21000,
            gasFees: packGasFees(1 gwei, 1 gwei),
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        bytes32 hash = entryPoint07.getUserOpHash(userOp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, MessageHashUtils.toEthSignedMessageHash(hash));
        userOp.signature = abi.encodePacked(r, s, v);

        return userOp;
    }

    // Create and sign PackedUserOperation for EntryPoint v0.8
    function createSignedUserOp08(uint256 salt, Call memory call, bytes memory paymasterAndData)
        internal
        view
        returns (PackedUserOperation08 memory)
    {
        // Derive sender address
        address sender = accountFactory08.getAddress(owner, salt);

        // Get nonce from EntryPoint
        uint256 nonce = entryPoint08.getNonce(sender, 0);

        // Check if account needs to be deployed
        bytes memory initCode = "";
        if (sender.code.length == 0) {
            initCode = abi.encodePacked(
                address(accountFactory08), abi.encodeCall(accountFactory08.createAccount, (owner, salt))
            );
        }

        PackedUserOperation08 memory userOp = PackedUserOperation08({
            sender: sender,
            nonce: nonce,
            initCode: initCode,
            callData: abi.encodeWithSelector(SimpleAccount08.execute.selector, call.to, call.value, call.data),
            accountGasLimits: packGasLimits(300000, 200000),
            preVerificationGas: 21000,
            gasFees: packGasFees(1 gwei, 1 gwei),
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        bytes32 hash = entryPoint08.getUserOpHash(userOp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, hash);
        userOp.signature = abi.encodePacked(r, s, v);

        return userOp;
    }

    // Create and sign PackedUserOperation for EntryPoint v0.8 with batch calls
    function createSignedUserOp08(uint256 salt, Call[] memory calls, bytes memory paymasterAndData)
        internal
        view
        returns (PackedUserOperation08 memory)
    {
        // Derive sender address
        address sender = accountFactory08.getAddress(owner, salt);

        // Get nonce from EntryPoint
        uint256 nonce = entryPoint08.getNonce(sender, 0);

        // Check if account needs to be deployed
        bytes memory initCode = "";
        if (sender.code.length == 0) {
            initCode = abi.encodePacked(
                address(accountFactory08), abi.encodeCall(accountFactory08.createAccount, (owner, salt))
            );
        }

        // For v0.8, executeBatch takes an array of Call structs
        // We need to convert our Call structs to BaseAccount.Call structs
        SimpleAccount08.Call[] memory baseCalls = new SimpleAccount08.Call[](calls.length);
        
        for (uint256 i = 0; i < calls.length; i++) {
            baseCalls[i] = SimpleAccount08.Call({
                target: calls[i].to,
                value: calls[i].value,
                data: calls[i].data
            });
        }

        // Encode the executeBatch call with the Call struct array
        bytes memory callData = abi.encodeWithSelector(SimpleAccount08.executeBatch.selector, baseCalls);

        PackedUserOperation08 memory userOp = PackedUserOperation08({
            sender: sender,
            nonce: nonce,
            initCode: initCode,
            callData: callData,
            accountGasLimits: packGasLimits(300000, 200000),
            preVerificationGas: 21000,
            gasFees: packGasFees(1 gwei, 1 gwei),
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        bytes32 hash = entryPoint08.getUserOpHash(userOp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, hash);
        userOp.signature = abi.encodePacked(r, s, v);

        return userOp;
    }

    // Helper to pack gas limits for v0.7/v0.8
    function packGasLimits(uint128 verificationGasLimit, uint128 callGasLimit) internal pure returns (bytes32) {
        return bytes32(uint256(verificationGasLimit) << 128 | uint256(callGasLimit));
    }

    // Helper to pack gas fees for v0.7/v0.8
    function packGasFees(uint128 maxPriorityFeePerGas, uint128 maxFeePerGas) internal pure returns (bytes32) {
        return bytes32(uint256(maxPriorityFeePerGas) << 128 | uint256(maxFeePerGas));
    }

    // Cast PackedUserOperation08 to PackedUserOperation07
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

    // Cast array of PackedUserOperation08 to PackedUserOperation07
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
}
