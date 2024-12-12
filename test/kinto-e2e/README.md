# Kinto E2E Tests

E2E tests for Kinto L2, the tests are performed by re-simulating successfully mined userOperations. Each test case will setup an Alto and Anvil instance at that block height and resubmit the userOperation using either `eth_sendUserOperation` or `pimlico_sendCompressedUserOperation`.

## Running The Tests

```
pnpm run test
```
