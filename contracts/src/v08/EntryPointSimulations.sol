// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */

import {IStakeManager as IStakeManager07} from "account-abstraction-v7/interfaces/IStakeManager.sol";
import {PackedUserOperation as PackedUserOperation07} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {UserOperationLib as UserOperationLib07} from "account-abstraction-v7/core/UserOperationLib.sol";
import {IEntryPoint as IEntryPoint07} from "account-abstraction-v7/interfaces/IEntryPoint.sol";

import {UserOperationLib as UserOperationLib08} from "account-abstraction-v8/core/UserOperationLib.sol";
import {PackedUserOperation as PackedUserOperation08} from "account-abstraction-v8/interfaces/PackedUserOperation.sol";
import {IEntryPoint as IEntryPoint08} from "account-abstraction-v8/interfaces/IEntryPoint.sol";

import "./EntryPoint.sol";
import {IEntryPointSimulations} from "../IEntryPointSimulations.sol";

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
contract EntryPointSimulations08 is EntryPoint, IEntryPointSimulations {
    EntryPointSimulations08 immutable thisContract = this;
    IEntryPoint07.AggregatorStakeInfo private NOT_AGGREGATED =
        IEntryPoint07.AggregatorStakeInfo(address(0), IStakeManager07.StakeInfo(0, 0));

    using UserOperationLib08 for PackedUserOperation07;

    // Thrown when the binary search fails due hitting the simulation gasLimit.
    error SimulationOutOfGas(uint256 optimalGas, uint256 minGas, uint256 maxGas);
    error innerCallResult(uint256 remainingGas);

    /**
     * simulation contract should not be deployed, and specifically, accounts should not trust
     * it as entrypoint, since the simulation functions don't check the signatures
     */
    constructor() {}

    // Helper function to convert a packed user operation to a packed user operation v8.
    function to08(PackedUserOperation07 memory op) internal pure returns (PackedUserOperation memory) {
        return PackedUserOperation08({
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

    /// @inheritdoc IEntryPointSimulations
    function simulateValidation(PackedUserOperation07 calldata userOp) public returns (ValidationResult memory) {
        UserOpInfo memory outOpInfo;

        _simulationOnlyValidations(userOp);
        (
            uint256 validationData,
            uint256 paymasterValidationData, // uint256 paymasterVerificationGasLimit
        ) = _validatePrepayment(0, to08(userOp), outOpInfo, true);

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
            _getMemoryBytesFromOffset(outOpInfo.contextOffset)
        );

        //EP07.AggregatorStakeInfo memory aggregatorInfo = NOT_AGGREGATED;
        //if (uint160(aggregator) != SIG_VALIDATION_SUCCESS && uint160(aggregator) != SIG_VALIDATION_FAILED) {
        //    aggregatorInfo = EP07.AggregatorStakeInfo(aggregator, _getStakeInfo(aggregator));
        //}
        //return ValidationResult(returnInfo, senderInfo, factoryInfo, paymasterInfo, aggregatorInfo);

        revert("TODO");
    }

    function encodeBinarySearchCalldata(BinarySearchMode mode, BinarySearchArgs calldata targetUserOp, uint256 gas)
        internal
        pure
        returns (bytes memory)
    {
        UserOpInfo memory opInfo;
        PackedUserOperation memory op = targetUserOp.op;

        if (mode == BinarySearchMode.PaymasterVerificationGasLimit) {
            (address paymaster,, uint256 postOpGasLimit) =
                UserOperationLib.unpackPaymasterStaticFields(targetUserOp.op.paymasterAndData);

            // Get paymaster data
            bytes memory paymasterData;
            if (op.paymasterAndData.length > UserOperationLib.PAYMASTER_DATA_OFFSET) {
                paymasterData = targetUserOp.op.paymasterAndData[UserOperationLib.PAYMASTER_DATA_OFFSET:];
            }

            // Rebuild paymasterAndData with custom paymasterVerificationGasLimit
            op.paymasterAndData =
                abi.encodePacked(paymaster, bytes16(uint128(gas)), bytes16(uint128(postOpGasLimit)), paymasterData);

            return abi.encodeWithSelector(this._paymasterValidation.selector, 0, op, opInfo, gas);
        }

        if (mode == BinarySearchMode.VerificationGasLimit) {
            uint256 callGasLimit = targetUserOp.op.unpackCallGasLimit();
            bytes32 accountGasLimits = bytes32((uint256(gas) << 128) | uint128(callGasLimit));
            op.accountGasLimits = accountGasLimits;
            return abi.encodeWithSelector(this._validatePrepayment.selector, 0, op, opInfo, false);
        }

        if (mode == BinarySearchMode.CallGasLimit) {
            address target = targetUserOp.target;
            bytes memory targetCallData = targetUserOp.targetCallData;
            return abi.encodeWithSelector(this.simulateCallAndRevert.selector, target, targetCallData, gas);
        }

        revert("Invalid mode");
    }

    function simulateValidationBulk(PackedUserOperation07[] calldata userOps)
        public
        returns (ValidationResult[] memory)
    {
        ValidationResult[] memory results = new ValidationResult[](userOps.length);

        for (uint256 i = 0; i < userOps.length; i++) {
            ValidationResult memory result = simulateValidation(userOps[i]);
            results[i] = result;
        }

        return results;
    }

    function simulateValidationLast(PackedUserOperation07[] calldata userOps)
        external
        returns (ValidationResult memory)
    {
        ValidationResult[] memory results = simulateValidationBulk(userOps);
        return results[userOps.length - 1];
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
        try IEntryPoint08(payable(entryPoint)).delegateAndRevert{gas: gas}(address(thisContract), payload) {}
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

    function processQueuedUserOps(BinarySearchArgs[] calldata queuedUserOps) internal {
        // Run all queued userOps to ensure that state is valid for the target userOp.
        for (uint256 i = 0; i < queuedUserOps.length; i++) {
            UserOpInfo memory queuedOpInfo;
            BinarySearchArgs calldata args = queuedUserOps[i];
            _simulationOnlyValidations(args.op);
            _validatePrepayment(0, args.op, queuedOpInfo, true);

            if (args.target == address(0)) {
                continue;
            }

            args.target.call(args.targetCallData);
        }
    }

    function binarySearchGasLimit(
        BinarySearchMode mode,
        BinarySearchArgs calldata targetUserOp,
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
                return BinarySearchResult(0, targetSuccess, targetResult);
            }
        } else {
            // Find the minGas (reduces number of iterations + checks if the call reverts).
            uint256 remainingGas = gasleft();
            bytes memory payload = encodeBinarySearchCalldata(mode, targetUserOp, gasleft());
            (targetSuccess, targetResult) = thisContract.simulateCall(entryPoint, payload, gasleft());
            minGas = remainingGas - gasleft();

            // If the call reverts then don't binary search.
            if (!targetSuccess) {
                return BinarySearchResult(0, targetSuccess, targetResult);
            }
        }

        uint256 maxGas = minGas + gasAllowance;
        uint256 optimalGas = maxGas;

        while ((maxGas - minGas) >= toleranceDelta) {
            // Check that we can do one more run.
            if (gasleft() < minGas + 5_000) {
                revert SimulationOutOfGas(optimalGas, minGas, maxGas);
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

        return BinarySearchResult(optimalGas, targetSuccess, targetResult);
    }

    function binarySearchPaymasterVerificationGasLimit(
        BinarySearchArgs[] calldata queuedUserOps,
        BinarySearchArgs calldata targetUserOp,
        address entryPoint,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) public returns (BinarySearchResult memory) {
        UserOpInfo memory setupOpInfo;
        _copyUserOpToMemory(targetUserOp.op, setupOpInfo.mUserOp);
        _validateAccountPrepayment(0, targetUserOp.op, setupOpInfo, 0, gasleft());

        // Prepare for simulation.
        processQueuedUserOps(queuedUserOps);
        _simulationOnlyValidations(targetUserOp.op);

        return binarySearchGasLimit(
            BinarySearchMode.PaymasterVerificationGasLimit,
            targetUserOp,
            entryPoint,
            initialMinGas,
            toleranceDelta,
            gasAllowance
        );
    }

    function binarySearchVerificationGasLimit(
        BinarySearchArgs[] calldata queuedUserOps,
        BinarySearchArgs calldata targetUserOp,
        address entryPoint,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) public returns (BinarySearchResult memory) {
        // Prepare for simulation.
        processQueuedUserOps(queuedUserOps);
        _simulationOnlyValidations(targetUserOp.op);

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
    function binarySearchCallGasLimit(
        BinarySearchArgs[] calldata queuedUserOps,
        BinarySearchArgs calldata targetUserOp,
        address entryPoint,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) public returns (BinarySearchResult memory) {
        processQueuedUserOps(queuedUserOps);

        // Extract out the target userOperation info.
        PackedUserOperation calldata op = targetUserOp.op;
        address target = targetUserOp.target;

        // Run our target userOperation.
        UserOpInfo memory opInfo;
        _simulationOnlyValidations(op);
        _validatePrepayment(0, op, opInfo, true);

        if (target == address(0)) {
            return BinarySearchResult(0, false, new bytes(0));
        }

        return binarySearchGasLimit(
            BinarySearchMode.CallGasLimit, targetUserOp, entryPoint, initialMinGas, toleranceDelta, gasAllowance
        );
    }

    /// @inheritdoc IEntryPointSimulations
    function simulateHandleOp(PackedUserOperation07 calldata op, address target, bytes memory targetCallData)
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

    function simulateHandleOpBulk(PackedUserOperation07[] calldata ops) public returns (ExecutionResult[] memory) {
        ExecutionResult[] memory results = new ExecutionResult[](ops.length);

        for (uint256 i = 0; i < ops.length; i++) {
            ExecutionResult memory result = simulateHandleOp(ops[i], address(0), "");

            results[i] = result;
        }

        return results;
    }

    function simulateHandleOpLast(PackedUserOperation07[] calldata ops) external returns (ExecutionResult memory) {
        ExecutionResult[] memory results = new ExecutionResult[](ops.length);

        results = simulateHandleOpBulk(ops);

        return results[ops.length - 1];
    }

    function _simulationOnlyValidations(PackedUserOperation07 calldata userOp) internal view {
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
