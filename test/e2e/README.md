# Alto E2E Test

E2E test will reconstruct a close to mainnet environment by deploying the following contracts:
- EntryPoint V0.7 to `0x0000000071727De22E5E9d8BAf0edAc6f37da032`.
- EntryPoint V0.6 to `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`.
- SimpleAccountFactory V0.7 to `0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985`.
- SimpleAccountFactory V0.6 to `0x9406Cc6185a346906296840746125a0E44976454`.
- EntryPoint Simulation to `0xf93dA0397eAEB3dA615ab8869b10634fe92c4327`.
- EntryPoint V0.8 to `0x4337084d9e255ff0702461cf8895ce9e3b5ff108`.
- SimpleAccountFactory V0.8 to `0x13E9ed32155810FDbd067D4522C492D6f68E5944`.

## Testing locally

Run mock environment

```
docker-compose up
```

Run test cases

```
pnpm run test
```

## Conflux eSpace testnet demo

This repo also includes a remote smoke test that:

- Ensures the deterministic deployer exists on Conflux eSpace Testnet
- Deploys `EntryPoint` v0.8 and `SimpleAccountFactory` v0.8 to their
  deterministic addresses when missing
- Starts a local Alto instance against the remote testnet RPC
- Funds the predicted SimpleAccount address
- Sends the first `eth_sendUserOperation`, which deploys the SimpleAccount and
  executes a native token transfer

### Environment

Copy [`.env.conflux-espace-testnet.example`](./.env.conflux-espace-testnet.example)
to `.env.conflux-espace-testnet` and fill in at least:

```bash
CONFLUX_ESPACE_TESTNET_RPC_URL=...
CONFLUX_ESPACE_TESTNET_BUNDLER_PRIVATE_KEY=...
```

Notes:

- `CONFLUX_ESPACE_TESTNET_EXECUTOR_PRIVATE_KEYS` is optional. If omitted, the
  bundler key is reused as the single executor key.
- `CONFLUX_ESPACE_TESTNET_OWNER_PRIVATE_KEY` is optional. If omitted, the test
  generates a throwaway owner for the demo account.
- The bundler key must hold enough native testnet gas to deploy contracts,
  fund the demo account, and submit the bundle transaction.
- The demo defaults to `safe-mode=false`, `balance-override=false`, and
  `code-override-support=false` because many public testnet RPCs do not expose
  the full tracing/state-override surface area. If your RPC supports those
  features, you can switch them back on in the env file.

### Run

From the repo root:

```bash
pnpm run test:conflux-espace
```

From `test/e2e` directly:

```bash
pnpm --dir ../.. run build:contracts
pnpm run test:conflux-espace
```
