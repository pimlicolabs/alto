# Kinto E2E Tests

E2E tests for Kinto L2, the tests are performed by re-simulating succesfully mined userOperations. Each test case will setup a Alto and Anvil instance at that block height and resubmit the userOperation using either `eth_sendUserOperation` or `pimlico_sendCompressedUserOperation`.

## Running The Tests

```
pnpm run test
```

## Running with workflow

Add the following workflow entry:

```
name: Run Kinto-E2E Tests
env:
  KINTO_RPC: ${{ secrets.KINTO_RPC }}

on:
  push:
    branches:
    - main
  pull_request:
    branches:
    - main

jobs:
  kinto-e2e:
    timeout-minutes: 10
    runs-on: ubuntu-latest

    steps:
    - name: Checkout
      uses: actions/checkout@v3

    - name: Set up foundry
      uses: foundry-rs/foundry-toolchain@v1

    - name: Install dependencies
      uses: ./.github/actions/install-dependencies

    - name: Install and build alto
      run: pnpm install && pnpm build

    - name: Install test dependencies
      run: cd test/kinto-e2e && pnpm install .

    - name: Start tests
      run: cd test/kinto-e2e && pnpm run test
```
