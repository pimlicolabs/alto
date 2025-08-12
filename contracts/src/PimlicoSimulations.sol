// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IEntryPointFilterOpsOverride08} from "./v08/IEntryPointFilterOpsOverride.sol";
import {EntryPointGasEstimationOverride06 as EpGasEstOverride06} from "./v06/EntryPointGasEstimationOverride.sol";
import {IEntryPointSimulations} from "./IEntryPointSimulations.sol";

import {PackedUserOperation} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {UserOperation} from "account-abstraction-v6/interfaces/UserOperation.sol";

import {IEntryPoint as IEntryPoint06} from "account-abstraction-v6/interfaces/IEntryPoint.sol";
import {IEntryPoint as IEntryPoint07} from "account-abstraction-v7/interfaces/IEntryPoint.sol";
import {IEntryPoint as IEntryPoint08} from "account-abstraction-v8/interfaces/IEntryPoint.sol";

import {Exec} from "account-abstraction-v7/utils/Exec.sol";

import {ERC20} from "solady/tokens/ERC20.sol";
import {LibBytes} from "solady/utils/LibBytes.sol";

/// @title PimlicoSimulations
/// @author Pimlico (https://github.com/pimlicolabs/alto)
/// @notice An ERC-4337 EntryPoint simulation contract
contract PimlicoSimulations {
    using LibBytes for bytes;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        Constructor                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    event PimlicoSimulationDeployed();

    constructor() {
        emit PimlicoSimulationDeployed();
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                          Helpers                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    // @notice Helper method to make a batch of arbitrary calls/simulations offchain.
    function simulateEntryPointBulk(address entryPointSimulation, address payable entryPoint, bytes[] memory data)
        public
        returns (bytes[] memory)
    {
        bytes[] memory returnDataArray = new bytes[](data.length);

        for (uint256 i = 0; i < data.length; i++) {
            bytes memory returnData;
            bytes memory callData =
                abi.encodeWithSelector(IEntryPoint07.delegateAndRevert.selector, entryPointSimulation, data[i]);
            bool success = Exec.call(entryPoint, 0, callData, gasleft());
            if (!success) {
                returnData = Exec.getReturnData(type(uint256).max);
            }
            returnDataArray[i] = returnData;
        }

        return returnDataArray;
    }

    // @notice Internal helper and parse the result of the EntryPoint's delegateAndRevert method.
    function _simulateEntryPoint(address entryPointSimulation, address entryPoint, bytes memory data)
        private
        returns (bytes memory)
    {
        bytes memory returnData;
        bytes4 selector = IEntryPoint07.delegateAndRevert.selector;
        bytes memory callData = abi.encodeWithSelector(selector, entryPointSimulation, data);
        bool success = Exec.call(entryPoint, 0, callData, gasleft());

        if (!success) {
            returnData = Exec.getReturnData(type(uint256).max);
        } else {
            revert("DelegateAndRevert did not revert as expected");
        }

        // Check if we have at least 4 bytes for the selector.
        if (returnData.length < 4) {
            revert("DelegateAndRevert revert data is too short");
        }

        // Extract the 4-byte selector using slice.
        bytes4 revertIdentifier = bytes4(returnData.slice(0, 4));
        if (revertIdentifier == IEntryPoint07.delegateAndRevert.selector) {
            revert("DelegateAndRevert did not revert with DelegateAndRevert error");
        }

        // Extract the revert data using slice.
        bytes memory revertData = returnData.slice(4, returnData.length);
        (bool delegateAndRevertSuccess, bytes memory delegateAndRevertData) = abi.decode(revertData, (bool, bytes));

        if (!delegateAndRevertSuccess) {
            Exec.revertWithData(delegateAndRevertData);
        }

        return delegateAndRevertData;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                    Estimation Methods                      */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    // @notice Helper type that returns Aggregate of estimations/simulations.
    struct SimulateAndEstimateGasResult {
        IEntryPointSimulations.ExecutionResult simulationResult;
        IEntryPointSimulations.BinarySearchResult verificationGasLimit;
        IEntryPointSimulations.BinarySearchResult paymasterVerificationGasLimit;
    }

    /// @notice Simulates userOp and estimates verification & paymaster gas limits
    function simulateAndEstimateGas(
        address entryPointSimulation,
        address payable entryPoint,
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (SimulateAndEstimateGasResult memory result) {
        // Step 1: Simulate the operation to ensure it's valid
        bytes4 selector = IEntryPointSimulations.simulateHandleOp.selector;
        bytes memory data = abi.encodeWithSelector(selector, queuedUserOps, targetUserOp);
        bytes memory returnData = _simulateEntryPoint(entryPointSimulation, entryPoint, data);
        result.simulationResult = abi.decode(returnData, (IEntryPointSimulations.ExecutionResult));

        // Step 2: Find optimal verification gas limit
        result.verificationGasLimit = this.binarySearchVerificationGas(
            entryPointSimulation, entryPoint, queuedUserOps, targetUserOp, initialMinGas, toleranceDelta, gasAllowance
        );

        // Step 3: If paymaster is present, find optimal paymaster verification gas limit
        if (targetUserOp.paymasterAndData.length >= 20) {
            result.paymasterVerificationGasLimit = this.binarySearchPaymasterVerificationGas(
                entryPointSimulation,
                entryPoint,
                queuedUserOps,
                targetUserOp,
                initialMinGas,
                toleranceDelta,
                gasAllowance
            );
        }
    }

    /// @notice Binary search for optimal verification gas limit
    function binarySearchVerificationGas(
        address entryPointSimulation,
        address payable entryPoint,
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (IEntryPointSimulations.BinarySearchResult memory) {
        bytes4 selector = IEntryPointSimulations.binarySearchVerificationGas.selector;
        bytes memory data = abi.encodeWithSelector(
            selector, queuedUserOps, targetUserOp, entryPoint, initialMinGas, toleranceDelta, gasAllowance
        );
        bytes memory returnData = _simulateEntryPoint(entryPointSimulation, entryPoint, data);
        return abi.decode(returnData, (IEntryPointSimulations.BinarySearchResult));
    }

    /// @notice Binary search for optimal paymaster verification gas limit
    function binarySearchPaymasterVerificationGas(
        address entryPointSimulation,
        address payable entryPoint,
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (IEntryPointSimulations.BinarySearchResult memory) {
        bytes4 selector = IEntryPointSimulations.binarySearchPaymasterVerificationGas.selector;
        bytes memory data = abi.encodeWithSelector(
            selector, queuedUserOps, targetUserOp, entryPoint, initialMinGas, toleranceDelta, gasAllowance
        );
        bytes memory returnData = _simulateEntryPoint(entryPointSimulation, entryPoint, data);
        return abi.decode(returnData, (IEntryPointSimulations.BinarySearchResult));
    }

    /// @notice Binary search for optimal call gas limit
    function binarySearchCallGas(
        address entryPointSimulation,
        address entryPoint,
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp,
        uint256 initialMinGas,
        uint256 toleranceDelta,
        uint256 gasAllowance
    ) external returns (IEntryPointSimulations.BinarySearchResult memory) {
        bytes4 selector = IEntryPointSimulations.binarySearchCallGas.selector;
        bytes memory data = abi.encodeWithSelector(
            selector, queuedUserOps, targetUserOp, entryPoint, initialMinGas, toleranceDelta, gasAllowance
        );
        bytes memory returnData = _simulateEntryPoint(entryPointSimulation, entryPoint, data);
        return abi.decode(returnData, (IEntryPointSimulations.BinarySearchResult));
    }

    /// @notice Simulates validation of a UserOperation
    function simulateValidation(
        address entryPointSimulation,
        address payable entryPoint,
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp
    ) external returns (IEntryPointSimulations.ValidationResult memory) {
        bytes4 selector = IEntryPointSimulations.simulateValidation.selector;
        bytes memory data = abi.encodeWithSelector(selector, queuedUserOps, targetUserOp);
        bytes memory returnData = _simulateEntryPoint(entryPointSimulation, entryPoint, data);
        return abi.decode(returnData, (IEntryPointSimulations.ValidationResult));
    }

    /// @notice Simulates handling of a UserOperation
    function simulateHandleOp(
        address entryPointSimulation,
        address payable entryPoint,
        PackedUserOperation[] calldata queuedUserOps,
        PackedUserOperation calldata targetUserOp
    ) external returns (IEntryPointSimulations.ExecutionResult memory) {
        bytes4 selector = IEntryPointSimulations.simulateHandleOp.selector;
        bytes memory data = abi.encodeWithSelector(selector, queuedUserOps, targetUserOp);
        bytes memory returnData = _simulateEntryPoint(entryPointSimulation, entryPoint, data);
        return abi.decode(returnData, (IEntryPointSimulations.ExecutionResult));
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                     FilterOps Methods                      */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    // @notice We use a in storage array so that we can use push().
    RejectedUserOp[] rejectedUserOps;

    // @notice Return type for userOps that are rejected by filterOps.
    struct RejectedUserOp {
        bytes32 userOpHash;
        bytes revertReason;
    }

    // @notice Return type for filterOps.
    struct FilterOpsResult {
        uint256 gasUsed;
        uint256 balanceChange;
        RejectedUserOp[] rejectedUserOps;
    }

    // @notice Filter ops method for EntryPoint 0.8
    // @dev This method should be called by bundler before sending bundle to EntryPoint.
    function filterOps08(PackedUserOperation[] calldata userOps, address payable beneficiary, IEntryPoint08 entryPoint)
        external
        returns (FilterOpsResult memory)
    {
        // Initialize the EntryPoint's domain separator.
        // Try-catch as some RPCs don't support code overrides.
        // In these cases the standard entryPoint will be used and trying to call initDomainSeparator will revert.
        try IEntryPointFilterOpsOverride08(payable(address(entryPoint))).initDomainSeparator() {} catch {}

        // 0.8 has the same filterOps logic as 0.7
        return this.filterOps07(userOps, beneficiary, IEntryPoint07(address(entryPoint)));
    }

    // @notice Filter ops method for EntryPoint 0.7
    // @dev This method should be called by bundler before sending bundle to EntryPoint.
    function filterOps07(PackedUserOperation[] calldata userOps, address payable beneficiary, IEntryPoint07 entryPoint)
        external
        returns (FilterOpsResult memory)
    {
        // Clear storage variable.
        rejectedUserOps = new RejectedUserOp[](0);

        // Set up memory variables.
        uint256 totalGasUsed = 0;
        uint256 totalBalanceChange = 0;

        // Process each UserOperation individually for O(n) complexity
        for (uint256 i = 0; i < userOps.length; i++) {
            // Create a single-element array for the current UserOperation
            PackedUserOperation[] memory singleOpArray = new PackedUserOperation[](1);
            singleOpArray[0] = userOps[i];

            uint256 balanceBefore = beneficiary.balance;
            uint256 gasBefore = gasleft();

            try entryPoint.handleOps(singleOpArray, beneficiary) {
                uint256 gasAfter = gasleft();
                uint256 balanceAfter = beneficiary.balance;

                // Accumulate gas used and balance changes
                totalGasUsed += gasBefore - gasAfter;
                totalBalanceChange += balanceAfter - balanceBefore;
            } catch (bytes memory revertReason) {
                // This UserOperation failed, add it to rejected list
                bytes32 userOpHash = entryPoint.getUserOpHash(userOps[i]);
                rejectedUserOps.push(RejectedUserOp({userOpHash: userOpHash, revertReason: revertReason}));
            }
        }

        return FilterOpsResult({
            gasUsed: totalGasUsed,
            balanceChange: totalBalanceChange,
            rejectedUserOps: rejectedUserOps
        });
    }

    // @notice Filter ops method for EntryPoint 0.6
    // @dev This method should be called by bundler before sending bundle to EntryPoint.
    function filterOps06(UserOperation[] calldata userOps, address payable beneficiary, IEntryPoint06 entryPoint)
        external
        returns (FilterOpsResult memory)
    {
        // Clear storage variable.
        rejectedUserOps = new RejectedUserOp[](0);

        // Set up memory variables.
        uint256 totalGasUsed = 0;
        uint256 totalBalanceChange = 0;

        // Process each UserOperation individually for O(n) complexity
        for (uint256 i = 0; i < userOps.length; i++) {
            // Create a single-element array for the current UserOperation
            UserOperation[] memory singleOpArray = new UserOperation[](1);
            singleOpArray[0] = userOps[i];

            uint256 balanceBefore = beneficiary.balance;
            uint256 gasBefore = gasleft();

            try entryPoint.handleOps(singleOpArray, beneficiary) {
                uint256 gasAfter = gasleft();
                uint256 balanceAfter = beneficiary.balance;

                // Accumulate gas used and balance changes
                totalGasUsed += gasBefore - gasAfter;
                totalBalanceChange += balanceAfter - balanceBefore;
            } catch (bytes memory revertReason) {
                // This UserOperation failed, add it to rejected list
                bytes32 userOpHash = entryPoint.getUserOpHash(userOps[i]);
                rejectedUserOps.push(RejectedUserOp({userOpHash: userOpHash, revertReason: revertReason}));
            }
        }

        return FilterOpsResult({
            gasUsed: totalGasUsed,
            balanceChange: totalBalanceChange,
            rejectedUserOps: rejectedUserOps
        });
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                  Asset Change Simulations                  */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    // @notice Result struct for balance queries
    struct AssetBalance {
        address addr;
        address token;
        uint256 amount;
    }

    // @notice Result struct for allowance queries
    struct AssetAllowance {
        address owner;
        address token;
        address spender;
        uint256 amount;
    }

    // @notice Result struct for balance change simulations
    struct BalanceChange {
        address addr;
        address token;
        uint256 balanceBefore;
        uint256 balanceAfter;
    }

    // @notice Result struct for allowance change simulations
    struct AllowanceChange {
        address owner;
        address token;
        address spender;
        uint256 allowanceBefore;
        uint256 allowanceAfter;
    }

    // @notice Get both balances and allowances in a single call
    // @dev Use 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE for native token
    function getBalancesAndAllowances(address[] calldata owners, address[] calldata tokens, address[] calldata spenders)
        public
        view
        returns (AssetBalance[] memory balances, AssetAllowance[] memory allowances)
    {
        // Get balances
        uint256 totalBalances = owners.length * tokens.length;
        balances = new AssetBalance[](totalBalances);
        uint256 balanceIndex = 0;

        for (uint256 i = 0; i < owners.length; i++) {
            address addr = owners[i];

            for (uint256 j = 0; j < tokens.length; j++) {
                uint256 amount;
                if (tokens[j] == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)) {
                    amount = addr.balance;
                } else {
                    amount = ERC20(tokens[j]).balanceOf(addr);
                }

                balances[balanceIndex++] = AssetBalance({addr: addr, token: tokens[j], amount: amount});
            }
        }

        // Get allowances
        uint256 totalAllowances = owners.length * tokens.length * spenders.length;
        allowances = new AssetAllowance[](totalAllowances);
        uint256 allowanceIndex = 0;

        for (uint256 i = 0; i < owners.length; i++) {
            for (uint256 j = 0; j < tokens.length; j++) {
                for (uint256 k = 0; k < spenders.length; k++) {
                    uint256 amount = 0;
                    // Native token has no allowances
                    if (tokens[j] != address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)) {
                        amount = ERC20(tokens[j]).allowance(owners[i], spenders[k]);
                    }

                    allowances[allowanceIndex++] =
                        AssetAllowance({owner: owners[i], token: tokens[j], spender: spenders[k], amount: amount});
                }
            }
        }

        return (balances, allowances);
    }

    // @notice Simulate asset changes for EntryPoint 0.8
    function simulateAssetChange08(
        PackedUserOperation calldata userOp,
        IEntryPoint08 entryPoint,
        address entryPointSimulations,
        address[] calldata owners,
        address[] calldata tokens,
        address[] calldata spenders
    ) external returns (BalanceChange[] memory, AllowanceChange[] memory) {
        // Initialize the EntryPoint's domain separator.
        // Try-catch as some RPCs don't support code overrides.
        // In these cases the standard entryPoint will be used and trying to call initDomainSeparator will revert.
        try IEntryPointFilterOpsOverride08(payable(address(entryPoint))).initDomainSeparator() {} catch {}

        return this.simulateAssetChange07(
            userOp, IEntryPoint07(address(entryPoint)), entryPointSimulations, owners, tokens, spenders
        );
    }

    // @notice Simulate asset changes for EntryPoint 0.7
    function simulateAssetChange07(
        PackedUserOperation calldata userOp,
        IEntryPoint07 entryPoint,
        address entryPointSimulations,
        address[] calldata owners,
        address[] calldata tokens,
        address[] calldata spenders
    ) external returns (BalanceChange[] memory balanceChanges, AllowanceChange[] memory allowanceChanges) {
        (AssetBalance[] memory balancesBefore, AssetAllowance[] memory allowancesBefore) =
            this.getBalancesAndAllowances(owners, tokens, spenders);

        // Encode the simulateHandleOpSingle call with our target and targetCallData
        bytes memory simulateHandleOpCallData = abi.encodeWithSelector(
            IEntryPointSimulations.simulateHandleOpSingle.selector,
            userOp,
            address(this),
            abi.encodeWithSelector(this.getBalancesAndAllowances.selector, owners, tokens, spenders)
        );

        // Use _simulateEntryPoint to execute through delegateAndRevert
        bytes memory result = _simulateEntryPoint(entryPointSimulations, address(entryPoint), simulateHandleOpCallData);

        // Decode the ExecutionResult
        IEntryPointSimulations.ExecutionResult memory executionResult =
            abi.decode(result, (IEntryPointSimulations.ExecutionResult));

        // Check if target call succeeded
        if (!executionResult.targetSuccess) {
            Exec.revertWithData(executionResult.targetResult);
        }

        // Decode the balances and allowances from the targetResult
        (AssetBalance[] memory balancesAfter, AssetAllowance[] memory allowancesAfter) =
            abi.decode(executionResult.targetResult, (AssetBalance[], AssetAllowance[]));

        // Calculate balance differences
        balanceChanges = new BalanceChange[](balancesBefore.length);
        for (uint256 i = 0; i < balancesBefore.length; i++) {
            balanceChanges[i] = BalanceChange({
                addr: balancesBefore[i].addr,
                token: balancesBefore[i].token,
                balanceBefore: balancesBefore[i].amount,
                balanceAfter: balancesAfter[i].amount
            });
        }

        // Calculate allowance differences
        allowanceChanges = new AllowanceChange[](allowancesBefore.length);
        for (uint256 i = 0; i < allowancesBefore.length; i++) {
            allowanceChanges[i] = AllowanceChange({
                owner: allowancesBefore[i].owner,
                token: allowancesBefore[i].token,
                spender: allowancesBefore[i].spender,
                allowanceBefore: allowancesBefore[i].amount,
                allowanceAfter: allowancesAfter[i].amount
            });
        }

        return (balanceChanges, allowanceChanges);
    }

    // @notice Simulate asset changes for EntryPoint 0.6
    function simulateAssetChange06(
        UserOperation calldata userOp,
        IEntryPoint06 entryPoint,
        address[] calldata owners,
        address[] calldata tokens,
        address[] calldata spenders
    ) external returns (BalanceChange[] memory balanceChanges, AllowanceChange[] memory allowanceChanges) {
        (AssetBalance[] memory balancesBefore, AssetAllowance[] memory allowancesBefore) =
            this.getBalancesAndAllowances(owners, tokens, spenders);
        AssetBalance[] memory balancesAfter;
        AssetAllowance[] memory allowancesAfter;

        address target = address(this);
        bytes memory targetCallData =
            abi.encodeWithSelector(this.getBalancesAndAllowances.selector, owners, tokens, spenders);

        try entryPoint.simulateHandleOp(userOp, target, targetCallData) {
            revert("simulateHandleOp must revert");
        } catch (bytes memory revertData) {
            if (revertData.length <= 4) {
                revert("Unexpected revert data format");
            }

            bytes4 selector = bytes4(revertData.slice(0, 4));

            // Bubble up any EntryPoint errors
            if (selector == IEntryPoint06.FailedOp.selector) {
                Exec.revertWithData(revertData);
            }

            // Bubble up any EntryPoint errors
            if (
                selector == EpGasEstOverride06.CallPhaseReverted.selector || selector == IEntryPoint06.FailedOp.selector
            ) {
                Exec.revertWithData(revertData);
            }

            bytes memory executionResultData = revertData.slice(4, revertData.length);

            (,,,, bool targetSuccess, bytes memory targetResult) = abi.decode(
                executionResultData,
                (
                    uint256, /*preOpGas*/
                    uint256, /*paid*/
                    uint48, /*validAfter*/
                    uint48, /*validUntil*/
                    bool, /*targetSuccess*/
                    bytes /*targetResult*/
                )
            );

            // Bubble up error if target call failed.
            if (!targetSuccess) {
                Exec.revertWithData(targetResult);
            }

            // Decode the balances and allowances from the targetResult
            (balancesAfter, allowancesAfter) = abi.decode(targetResult, (AssetBalance[], AssetAllowance[]));
        }

        // Calculate balance differences
        balanceChanges = new BalanceChange[](balancesBefore.length);
        for (uint256 i = 0; i < balancesBefore.length; i++) {
            balanceChanges[i] = BalanceChange({
                addr: balancesBefore[i].addr,
                token: balancesBefore[i].token,
                balanceBefore: balancesBefore[i].amount,
                balanceAfter: balancesAfter[i].amount
            });
        }

        // Calculate allowance differences
        allowanceChanges = new AllowanceChange[](allowancesBefore.length);
        for (uint256 i = 0; i < allowancesBefore.length; i++) {
            allowanceChanges[i] = AllowanceChange({
                owner: allowancesBefore[i].owner,
                token: allowancesBefore[i].token,
                spender: allowancesBefore[i].spender,
                allowanceBefore: allowancesBefore[i].amount,
                allowanceAfter: allowancesAfter[i].amount
            });
        }

        return (balanceChanges, allowanceChanges);
    }
}
