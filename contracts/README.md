# Alto Contracts

Contracts used for simulation and validation by the bundler.

## Contract Structure

### Version Specific Contracts

Each supported EntryPoint version (v06, v07, v08, v09) has its own directory under `src/` containing:

| Contract | Bundler Usage |
|----------|---------------|
| `EntryPoint.sol` | Used internally by `EntryPointSimulations.sol`. Modified EntryPoint for simulations. |
| `EntryPointSimulations.sol` | Used in `eth_estimateUserOperationGas`. has methods for binary searching precise gas limits. This contract is deployed onchain.  |
| `EntryPointFilterOpsOverride.sol` | Bytecode used as state override in `eth_call` before bundle submission. Replaces EntryPoint code to filter failed ops. |

> Note: All versions use the 0.7 EntryPoint interface, because of this 0.8 and 0.9 have `override` to support the 0.7 PackedUserOperation struct.

### Shared Contracts

Located in `src/`:

| Contract | Bundler Usage |
|----------|---------------|
| `PimlicoSimulations.sol` | Orchestrator for gas estimation and simulations. Routes to version specific contracts. |
| `IEntryPointSimulations.sol` | Shared interface for simulation results and binary search operations. |
| `SimulationOverrideHelper.sol` | Helper for reading simulation storage slots (i.e block.basefee and block.timestamp). |


## EntryPoint Interface Handling

For EntryPoint 0.8 support, we leverage the fact that 0.7 and 0.8 share the same interface. To avoid duplication:
- We use 0.7 interfaces throughout the codebase
- Where necessary, we override specific files to handle cases where only the interface import has changed
- This approach prevents Solidity compilation errors while maintaining compatibility with both versions

## Contract roles

### PimlicoSimulations

Router contract called by the bundler to handle anything simulation related.

### EntryPointFilterOpsOverride

This contract is used as a code override during the bundler's sanity simulation before bundle submission. The bundler calls PimlicoSimulations's `filterOps06`, `filterOps07`, `filterOps08`, or `filterOps09`. These functions will iterate through each userOp in the bundle and call the EntryPoint's handleOp method and records if the userOp suceeded/failed as well as the gasUsed and beneficiaryFees.

All userOps that fail are collected in the rejectedUserOps array and will be dropped by the bundler, the gasUsed and beneficiaryFees are used by the bundler when setting the bundle tx's gasFees.

We need to override the EntryPoint's code when calling filterOps for these reasons:
- remove AA95 check (this check is irrelevant for sanity simulations, the bundler also sets a gasLimit offchain that meets the AA95 requirement)
- `senderManager` (immutable variables are part of the runtime code and set in constructor, a plain code override won't work as it uses default values)
- For 0.7, 0.8, 0.9 build the domainSeparator because this is a immutable variable set by the EntryPoint in constructor
- `block.timestamp`, (eth_call timestamp may differ from real timestamp, rare but has been observed in prod)
- `block.basefee` (eth_call sets a baseFee of 0, we need a well defined baseFee for the AA21 check)
- For 0.9 we remove the ReEntrancyGuard because the msg.sender is PimlicoSimulations and would fail the `tx.origin == msg.sender` check otherwise

> All overrides are made using the `SimulationOverrideHelper.sol` helper contract.

### EntryPointSimulations

This contract is used by the bundler for gasEstimation and during eth_sendUserOperation validations.

0.7, 0.8, and 0.9 EntryPoint.sol have these modifications:
- Remove AA95 check
- Added custom `CallPhaseReverted` error to bubble up any callphase reverts
- Remove AA32 paymaster expiry check (this is checked by the bundler)
- update `_validatePrepayment` to return the paymasterVerificationGas used
- update `_postExecution` to return the paymasterPostOpGas used
- update `_validateAccountPrepayment` such that we pass in a verificationGasLimit when calling IAccount.validateUserOp (instead of relying on userOp.verificationGasLimit)
- update `_validatePaymasterPrepayment` such that we pass in a paymasterVerificationGasLimit when calling IPaymaster.validatePaymasterUserOp (instead of relying on userOp.paymasterVerificationGasLimit)
- Remove re-entrancy guard for 0.9 (due to the msg.sender === tx.origin check, during simulations msg.sender is PimlicoSimulations)
- We have to override some of the EntryPoint 0.8 / 0.9 code to support the 0.7 packedUserOp struct. This is purely a syntax change, code functionality remains the same.
