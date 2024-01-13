# E2E Test

basic e2e test suites are located in `./test_suite/src/basic.test.ts`

e2e test will reconstruct a close to mainnet environment by deploying the following contracts:
- EntryPoint to `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`.
- SimpleAccountFactory to `0x9406Cc6185a346906296840746125a0E44976454`.

## Testing locally

Run (if all test pass the container test_suite will exit with exit code 0)

```
docker-compose up --abort-on-container-exit test_suite
```
