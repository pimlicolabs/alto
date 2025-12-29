# Alto Contracts

Contracts used for simulation and validation by the bundler.

## Version Specific Contracts

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
