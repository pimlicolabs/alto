# E2E Test

basic e2e test suites are located in `./test_suite/src/basic.test.ts`

e2e test will reconstruct a close to mainnet environment by deploying the following contracts:
- EntryPoint to `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`.
- SimpleAccountFactory to `0x9406Cc6185a346906296840746125a0E44976454`.
- BundleBulker to `0x09aeBCF1DF7d4D0FBf26073e79A6B250f458fFB8`.
- PerOpInflator to `0xcc2cCFF1dC613D41A5132D5EaBb99e7b28577707`.
- PerOpInflator is registered with BundleBulker under id 4337.

## Testing locally

Run (if all test pass the container test_suite will exit with exit code 0)

```
docker-compose up --abort-on-container-exit test_suite
```
