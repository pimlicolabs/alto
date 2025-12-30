// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */

import {IEntryPointSimulations} from "../IEntryPointSimulations.sol";
import {EntryPoint} from "./EntryPoint.sol";

import {SIG_VALIDATION_SUCCESS, SIG_VALIDATION_FAILED} from "account-abstraction-v7/core/Helpers.sol";
import {PackedUserOperation} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {UserOperationLib} from "account-abstraction-v7/core/UserOperationLib.sol";
import {IEntryPoint} from "account-abstraction-v7/interfaces/IEntryPoint.sol";
import {IAccountExecute} from "account-abstraction-v7/interfaces/IAccountExecute.sol";

enum BinarySearchMode {
    PaymasterPostOpGasLimit, // TODO
    CallGasLimit,
    PaymasterVerificationGasLimit,
    VerificationGasLimit
}

/*
 * This contract inherits the EntryPoint and extends it with the view-only methods that are executed by
 * the bundler in order to check UserOperation validity and estimate its gas consumption.
 * This contract should never be deployed on-chain and is only used as a parameter for the "eth_call" request.
 */
contract EntryPointSimulations07 is EntryPoint, IEntryPointSimulations {
    EntryPointSimulations07 immutable thisContract = this;
    AggregatorStakeInfo private NOT_AGGREGATED = AggregatorStakeInfo(address(0), StakeInfo(0, 0));

    using UserOperationLib for PackedUserOperation;

    error innerCallResult(uint256 remainingGas);

    /**
     * simulation contract should not be deployed, and specifically, accounts should not trust
     * it as entrypoint, since the simulation functions don't check the signatures
     */
    constructor() {}

    /// @notice simulate and validates a single userOperation (taken from EntryPoint simulation example)
    function simulateValidation(PackedUserOperation calldata userOp) public returns (ValidationResult memory) {
        UserOpInfo memory outOpInfo;

        _simulationOnlyValidations(userOp);
        (
            uint256 validationData,
            uint256 paymasterValidationData, // uint256 paymasterVerificationGasLimit
        ) = _validatePrepayment(0, userOp, outOpInfo, true);

        _validateAccountAndPaymasterValidationData(0, validationData, paymasterValidationData, address(0));

        StakeInfo memory paymasterInfo = _getStakeInfo(outOpInfo.mUserOp.paymaster);
        StakeInfo memory senderInfo = _getStakeInfo(outOpInfo.mUserOp.sender);
        StakeInfo memory factoryInfo;
        {
            bytes calldata initCode = userOp.initCode;
            address factory = initCode.length >= 20 ? address(bytes20(initCode[0:20])) : address(0);
            factoryInfo = _getStakeInfo(factory);
        }

        address aggregator = address(uint160(validationData));
        ReturnInfo memory returnInfo = ReturnInfo(
            outOpInfo.preOpGas,
            outOpInfo.prefund,
            validationData,
            paymasterValidationData,
            getMemoryBytesFromOffset(outOpInfo.contextOffset)
        );

        AggregatorStakeInfo memory aggregatorInfo = NOT_AGGREGATED;
        if (uint160(aggregator) != SIG_VALIDATION_SUCCESS && uint160(aggregator) != SIG_VALIDATION_FAILED) {
            aggregatorInfo = AggregatorStakeInfo(aggregator, _getStakeInfo(aggregator));
        }
        return ValidationResult(returnInfo, senderInfo, factoryInfo, paymasterInfo, aggregatorInfo);
    }

    /// @notice Helper function to encode target call data for a user operation
    function _encodeTargetCallData(PackedUserOperation calldata userOp, bytes32 userOpHash)
        internal
        pure
        returns (address target, bytes memory targetCallData)
    {
        target = userOp.sender;
        bytes calldata callData = userOp.callData;

        // Encode userOperation calldata
        bytes4 methodSig;
        assembly ("memory-safe") {
            let len := callData.length
            if gt(len, 3) { methodSig := calldataload(callData.offset) }
        }
        if (methodSig == IAccountExecute.executeUserOp.selector) {
            targetCallData = abi.encodeCall(IAccountExecute.executeUserOp, (userOp, userOpHash));
        } else {
            targetCallData = userOp.callData;
        }
    }

    function encodeBinarySearchCalldata(BinarySearchMode mode, PackedUserOperation calldata targetUserOp, uint256 gas)
        internal
        pure
        returns (bytes memory)
    {
        UserOpInfo memory opInfo;
        PackedUserOperation memory op = targetUserOp;

        if (mode == BinarySearchMode.PaymasterVerificationGasLimit) {
            (address paymaster,, uint256 postOpGasLimit) =
                UserOperationLib.unpackPaymasterStaticFields(targetUserOp.paymasterAndData);

            // Get paymaster data
            bytes memory paymasterData;
            if (op.paymasterAndData.length > UserOperationLib.PAYMASTER_DATA_OFFSET) {
                paymasterData = targetUserOp.paymasterAndData[UserOperationLib.PAYMASTER_DATA_OFFSET:];
            }

            // Rebuild paymasterAndData with custom paymasterVerificationGasLimit
            op.paymasterAndData =
                abi.encodePacked(paymaster, bytes16(uint128(gas)), bytes16(uint128(postOpGasLimit)), paymasterData);

            return abi.encodeWithSelector(this._paymasterValidation.selector, 0, op, opInfo, gas);
        }

        if (mode == BinarySearchMode.VerificationGasLimit) {
            uint256 callGasLimit = targetUserOp.unpackCallGasLimit();
            bytes32 accountGasLimits = bytes32((uint256(gas) << 128) | uint128(callGasLimit));
            op.accountGasLimits = accountGasLimits;
            return abi.encodeWithSelector(this._validatePrepayment.selector, 0, op, opInfo, false);
        }

        if (mode == BinarySearchMode.CallGasLimit) {
            (address target, bytes memory targetCallData) = _encodeTargetCallData(targetUserOp, opInfo.userOpHash);
            return abi.encodeWithSelector(this.simulateCallAndRevert.selector, target, targetCallData, gas);
        }

        revert("Invalid mode");
    }

    function simulateValidation(PackedUserOperation[] calldata queuedUserOps, PackedUserOperation calldata targetUserOp)
        external
        returns (ValidationResult memory)
    {
        // Validate all queued operations first to set up state
        for (uint256 i = 0; i < queuedUserOps.length; i++) {
            simulateValidation(queuedUserOps[i]);
        }

        // Validate and return the result of the target operation
        return simulateValidation(targetUserOp);
    }

    function simulateCallAndRevert(address target, bytes calldata data, uint256 gas) external {
        (bool success, bytes memory returnData) = target.call{gas: gas}(data);
        if (!success) {
            if (returnData.length == 0) revert();
            assembly {
                revert(add(32, returnData), mload(returnData))
            }
        }
    }

    // Helper function to perform the simulation and capture results from revert bytes.
    function simulateCall(address entryPoint, bytes calldata payload, uint256 gas)
        external
        returns (bool success, bytes memory result)
    {
        try IEntryPoint(payable(entryPoint)).delegateAndRevert{gas: gas}(address(thisContract), payload) {}
        catch (bytes memory reason) {
            if (reason.length < 4) {
                // Calls that revert due to out of gas revert with empty bytes.
                return (false, new bytes(0));
            }

            bytes memory reasonData = new bytes(reason.length - 4);
            for (uint256 i = 4; i < reason.length; i++) {
                reasonData[i - 4] = reason[i];
            }
            (success, result) = abi.decode(reasonData, (bool, bytes));
        }
    }

    function processQueuedUserOps(PackedUserOperation[] calldata queuedUserOps) internal {
        // Run all queued userOps to ensure that state is valid for the target userOp.
        for (uint256 i = 0; i < queuedUserOps.length; i++) {
            UserOpInfo memory opInfo;
            PackedUserOperation calldata userOp = queuedUserOps[i];
            _simulationOnlyValidations(userOp);
            _validatePrepayment(0, userOp, opInfo, true);

            // If there is no callData to execute, skip
            if (userOp.callData.length == 0) {
                continue;
            }

            // Execute calldata
            (address target, bytes memory targetCallData) = _encodeTargetCallData(userOp, opInfo.userOpHash);
            target.call(targetCallData);
        }
    }

    function binarySearchGasLimit(
        BinarySearchMode mode,
        PackedUserOperation calldata targetUserOp,
        address entryPoint,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) internal returns (BinarySearchResult memory) {
        uint256 minGas;
        bool targetSuccess;
        bytes memory targetResult;

        if (initialMinGas > 0) {
            targetSuccess = true;
            targetResult = hex"";
            minGas = initialMinGas;

            bytes memory payload = encodeBinarySearchCalldata(mode, targetUserOp, gasleft());
            (targetSuccess, targetResult) = thisContract.simulateCall(entryPoint, payload, gasleft());

            // If the call reverts then don't binary search.
            if (!targetSuccess) {
                return BinarySearchResult(
                    BinarySearchResultType.Success,
                    BinarySearchSuccess(0, targetSuccess, targetResult),
                    BinarySearchOutOfGas(0, 0, 0) // Empty (result not used)
                );
            }
        } else {
            // Find the minGas (reduces number of iterations + checks if the call reverts).
            uint256 remainingGas = gasleft();
            bytes memory payload = encodeBinarySearchCalldata(mode, targetUserOp, gasleft());
            (targetSuccess, targetResult) = thisContract.simulateCall(entryPoint, payload, gasleft());
            minGas = remainingGas - gasleft();

            // If the call reverts then don't binary search.
            if (!targetSuccess) {
                return BinarySearchResult(
                    BinarySearchResultType.Success,
                    BinarySearchSuccess(0, targetSuccess, targetResult),
                    BinarySearchOutOfGas(0, 0, 0) // Empty (result not used)
                );
            }
        }

        uint256 maxGas = minGas + gasAllowance;
        uint256 optimalGas = maxGas;

        while ((maxGas - minGas) >= toleranceDelta) {
            // Check that we can do one more run.
            if (gasleft() < minGas + 5_000) {
                return BinarySearchResult(
                    BinarySearchResultType.OutOfGas,
                    BinarySearchSuccess(0, false, new bytes(0)), // Empty (result not used)
                    BinarySearchOutOfGas(optimalGas, minGas, maxGas)
                );
            }

            uint256 midGas = (minGas + maxGas) / 2;

            bytes memory payload = encodeBinarySearchCalldata(mode, targetUserOp, midGas);
            (bool success, bytes memory result) = thisContract.simulateCall(entryPoint, payload, gasleft());

            if (success) {
                // If the call is successful, reduce the maxGas and store this as the candidate
                optimalGas = midGas;
                maxGas = midGas - 1;
                targetResult = result;
            } else {
                // If it fails, we need more gas, so increase the minGas
                minGas = midGas + 1;
            }
        }

        return BinarySearchResult(
            BinarySearchResultType.Success,
            BinarySearchSuccess(optimalGas, targetSuccess, targetResult),
            BinarySearchOutOfGas(0, 0, 0) // Empty (result not used)
        );
    }

    function binarySearchPaymasterVerificationGas(
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        address entryPoint,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) public returns (BinarySearchResult memory) {
        // If there is no paymaster, _validatePaymasterUserOp is never called.
        if (targetUserOp.paymasterAndData.length < 20) {
            return BinarySearchResult(
                BinarySearchResultType.Success,
                BinarySearchSuccess(0, false, new bytes(0)),
                BinarySearchOutOfGas(0, 0, 0) // Empty (result not used)
            );
        }

        UserOpInfo memory setupOpInfo;
        _copyUserOpToMemory(targetUserOp, setupOpInfo.mUserOp);
        _validateAccountPrepayment(0, targetUserOp, setupOpInfo, 0, gasleft());

        // Prepare for simulation.
        processQueuedUserOps(queuedUserOps);
        _simulationOnlyValidations(targetUserOp);

        return binarySearchGasLimit(
            BinarySearchMode.PaymasterVerificationGasLimit,
            targetUserOp,
            entryPoint,
            initialMinGas,
            toleranceDelta,
            gasAllowance
        );
    }

    function binarySearchVerificationGas(
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        address entryPoint,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) public returns (BinarySearchResult memory) {
        // Prepare for simulation.
        processQueuedUserOps(queuedUserOps);
        _simulationOnlyValidations(targetUserOp);

        return binarySearchGasLimit(
            BinarySearchMode.VerificationGasLimit, targetUserOp, entryPoint, initialMinGas, toleranceDelta, gasAllowance
        );
    }

    /*
     * Helper function to estimate the call gas limit for a given userOperation.
     * The userOperation's callGasLimit is found by performing a onchain binary search.
     *
     * @param queuedUserOps - The userOperations that should be simulated before the targetUserOperation.
     * @param targetUserOp - The userOperation to simulate.
     * @param entryPoint - The address of the entryPoint contract.
     * @param toleranceDelta - The maximum difference between the estimated gas and the actual gas.
     * @param initialMinGas - The initial gas value to start the binary search with.
     * @param gasAllowance - The margin to add to the binary search to account for overhead.
     * @return optimalGas - The estimated gas limit for the call.
     */
    function binarySearchCallGas(
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        address entryPoint,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) public returns (BinarySearchResult memory) {
        // If callData.length == 0, EntryPoint skips innerHandleOp phase.
        if (targetUserOp.callData.length == 0) {
            return BinarySearchResult(
                BinarySearchResultType.Success,
                BinarySearchSuccess(0, false, new bytes(0)),
                BinarySearchOutOfGas(0, 0, 0) // Empty (result not used)
            );
        }

        processQueuedUserOps(queuedUserOps);

        // Extract out the target userOperation info.
        PackedUserOperation calldata op = targetUserOp;

        // Run our target userOperation.
        UserOpInfo memory opInfo;
        _simulationOnlyValidations(op);
        _validatePrepayment(0, op, opInfo, true);

        return binarySearchGasLimit(
            BinarySearchMode.CallGasLimit, targetUserOp, entryPoint, initialMinGas, toleranceDelta, gasAllowance
        );
    }

    /// @notice simulates a single userOperation (taken from EntryPoint simulation example)
    function simulateHandleOpSingle(PackedUserOperation calldata op, address target, bytes memory targetCallData)
        public
        nonReentrant
        returns (ExecutionResult memory)
    {
        UserOpInfo memory opInfo;
        _simulationOnlyValidations(op);
        (uint256 validationData, uint256 paymasterValidationData, uint256 paymasterVerificationGasLimit) =
            _validatePrepayment(0, op, opInfo, true);

        (uint256 paid, uint256 paymasterPostOpGasLimit) = _executeUserOp(0, op, opInfo);

        bool targetSuccess;
        bytes memory targetResult;
        if (target != address(0)) {
            (targetSuccess, targetResult) = target.call(targetCallData);
        }

        return ExecutionResult(
            opInfo.preOpGas,
            paid,
            validationData,
            paymasterValidationData,
            paymasterVerificationGasLimit,
            paymasterPostOpGasLimit,
            targetSuccess,
            targetResult
        );
    }

    function simulateHandleOp(PackedUserOperation[] calldata queuedUserOps, PackedUserOperation calldata targetUserOp)
        external
        returns (ExecutionResult memory)
    {
        // Execute all queued operations first to set up state
        for (uint256 i = 0; i < queuedUserOps.length; i++) {
            simulateHandleOpSingle(queuedUserOps[i], address(0), "");
        }

        // Execute and return the result of the target operation
        return simulateHandleOpSingle(targetUserOp, address(0), "");
    }

    function _simulationOnlyValidations(PackedUserOperation calldata userOp) internal view {
        string memory revertReason =
            _validateSenderAndPaymaster(userOp.initCode, userOp.sender, userOp.paymasterAndData);
        if (bytes(revertReason).length != 0) {
            revert FailedOp(0, revertReason);
        }
    }

    /**
     * Called only during simulation.
     * This function always reverts to prevent warm/cold storage differentiation in simulation vs execution.
     * @param initCode         - The smart account constructor code.
     * @param sender           - The sender address.
     * @param paymasterAndData - The paymaster address (followed by other params, ignored by this method)
     */
    function _validateSenderAndPaymaster(bytes calldata initCode, address sender, bytes calldata paymasterAndData)
        internal
        view
        returns (string memory)
    {
        if (initCode.length == 0 && sender.code.length == 0) {
            // it would revert anyway. but give a meaningful message
            return ("AA20 account not deployed");
        }
        if (paymasterAndData.length >= 20) {
            address paymaster = address(bytes20(paymasterAndData[0:20]));
            if (paymaster.code.length == 0) {
                // It would revert anyway. but give a meaningful message.
                return ("AA30 paymaster not deployed");
            }
        }
        // always revert
        return ("");
    }
}
