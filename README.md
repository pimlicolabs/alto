<p align="center"><a href="https://docs.pimlico/reference/bundler"><img width="1000" title="Alto" src='https://i.imgur.com/qgVAdjN.png' /></a></p>

# ⛰️ Alto ⛰️

![Node Version](https://img.shields.io/badge/node-20.x-green)

Alto is a Typescript implementation of the [ERC-4337 bundler specification](https://eips.ethereum.org/EIPS/eip-4337) developed by [Pimlico](https://pimlico.io), focused on transaction inclusion reliability.

## Getting started

For a full explanation of Alto, please visit our [docs page](https://docs.pimlico.io/infra/bundler)

#### Run an instance of Alto with the following commands:
```bash
pnpm install
pnpm build
./alto --entrypoints "0x5ff1...2789,0x0000...a032" --executor-private-keys "..." --utility-private-key "..." --min-balance "0" --rpc-url "http://localhost:8545" --network-name "local"
```
To find a list of all options, run:
```bash
./alto help
```

A helper script for running Alto locally with an Anvil node can be found at [scripts/run-local-instance.sh](scripts/README.md).

A comprehensive guide for self-hosting Alto can be found [here](https://docs.pimlico.io/infra/bundler/self-host).

#### Run the test suite with the following commands:
```bash
pnpm build
pnpm test # note: foundry must be installed on the machine for this to work
```

## Prerequisites

- :gear: [NodeJS](https://nodejs.org/) (LTS)
- :toolbox: [Pnpm](https://pnpm.io/)

## How to test bundler specs

- Run Geth node or any other node that support debug_traceCall
- Clone [bundler-spec-tests](https://github.com/eth-infinitism/bundler-spec-tests) repo.
- build & run bundler with `--environment development --bundleMode manual --safeMode true`


## License

Distributed under the GPL-3.0 License. See [LICENSE](./LICENSE) for more information.

## Contact

Feel free to ask any questions in our [Telegram group](https://t.me/pimlicoHQ)

## Acknowledgements

- [Eth-Infinitism bundler](https://github.com/eth-infinitism/bundler)
- [Lodestar](https://github.com/ChainSafe/lodestar)
