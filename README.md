<p align="center"><a href="https://docs.pimlico/reference/bundler"><img width="1000" title="Alto" src='https://i.imgur.com/qgVAdjN.png' /></a></p>

# ⛰️ Alto ⛰️ 

![GitHub release (latest by date)](https://img.shields.io/github/v/release/pimlicolabs/alto)
![GitHub Workflow Status (with branch)](https://img.shields.io/github/actions/workflow/status/pimlicolabs/alto/tests.yml?branch=main)
![Node Version](https://img.shields.io/badge/node-18.x-green)

Alto is a Typescript implementation of the [ERC-4337 bundler specification](https://eips.ethereum.org/EIPS/eip-4337) developed by [Pimlico](https://pimlico.io), focused on type safety and transaction inclusion reliability.

## Getting started

For a full explanation of Alto, please visit our [docs page](https://docs.pimlico.io/reference/bundler)

Run an instance of Alto with the following commands:
```bash
pnpm build
./alto
```

Run the test suite with the following commands:
```bash
pnpm build
pnpm test # note: foundry must be installed on the machine for this to work
```

## Prerequisites

- :gear: [NodeJS](https://nodejs.org/) (LTS)
- :toolbox: [Pnpm](https://pnpm.io/)

## License

Distributed under the GPL-3.0 License. See [LICENSE](./LICENSE) for more information.

## Contact

Feel free to ask any questions in our [Telegram group](https://t.me/pimlicoHQ)

## Acknowledgements

- [Eth-Infinitism bundler](https://github.com/eth-infinitism/bundler)
- [Lodestar](https://github.com/ChainSafe/lodestar)
