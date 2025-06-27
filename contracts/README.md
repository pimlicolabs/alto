# Alto Contracts

This directory contains smart contracts used for simulation and validation in bundler.

## Purpose

The contracts in this directory serve as supporting infrastructure for the bundler's operation, providing:
- Simulation capabilities for user operations
- Validation helpers for gas estimation

## EntryPoint Interface Handling

For EntryPoint 0.8 support, we leverage the fact that 0.7 and 0.8 share the same interface. To avoid duplication:
- We use 0.7 interfaces throughout the codebase
- Where necessary, we override specific files to handle cases where only the interface import has changed
- This approach prevents Solidity compilation errors while maintaining compatibility with both versions
