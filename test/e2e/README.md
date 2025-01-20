# Alto E2E Test

E2E test will reconstruct a close to mainnet environment by deploying the following contracts:
- EntryPoint V0.7 to `0x0000000071727De22E5E9d8BAf0edAc6f37da032`.
- EntryPoint V0.6 to `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`.
- SimpleAccountFactory V0.7 to `0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985`.
- SimpleAccountFactory V0.6 to `0x9406Cc6185a346906296840746125a0E44976454`.
- EntryPoint Simulation to `0xf93dA0397eAEB3dA615ab8869b10634fe92c4327`.

## Testing locally

Run mock environment

```
docker-compose up
```

Run test cases

```
pnpm run test
```
