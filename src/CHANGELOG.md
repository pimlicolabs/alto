# @pimlico/alto

## 0.0.12

### Patch Changes

- f6aeb6fba01e4b75b190a9ccbe45e406147835b6: Fixed nonceQueue bug where onchain nonce was checked against nonce sequence

## 0.0.11

### Patch Changes

- aee3c93b25a054d238390b3a89b38a85e698e72e: Added bull library as dependency

## 0.0.10

### Patch Changes

- c24525f825563527ddce13224ad352ff2cda68e0: Added code till Dec 18

## 0.0.9

### Patch Changes

- 87056b4a0884a0a9f8dd8534735deb66540aa3bc: Version updated till Dec 18
- c7fabb9d5c5056b573df56bc72c769a00035dc76: Fixed bug in `gasPriceManager` that leads to infinite recursion when calling `getBaseFee`

## 0.0.8

### Patch Changes

- 101fadc6c8f358b7a9d30c6263b0346f674dea3e: Created 0.0.8 release

## 0.0.7

### Patch Changes

- 8588fbd30e111228d5d9422f538b0633357166d7: Improved calldata gas estimations for v0.7 userOperations

## 0.0.6

### Patch Changes

- 9a7b8fcd614a0076f4da5091f31b453ae3ca3ebc: Fixed bug where fixed 5m gas limit was used for bundle transaction instead of `max-gas-limit-per-bundle`

## 0.0.5

### Patch Changes

- c1775902ead108325c2c3bef81535a53ba092311: Fixed bug where gas estimate is too low leading to the bundling tx reverting onchain due to AA95
- d831ddb90dcf942a2cc4998fcf35258e0f862fb4: Added --enable-instant-bundling-endpoint flag to enable the pimlico_sendUserOperationNow endpoint

## 0.0.4

### Patch Changes

- 51dc53e2f67b4dec7957f2595912269353d77755: Fixed bug in eth_getUserOperationByHash when querying entrypoint 0.7 user operation hash
- 51dc53e2f67b4dec7957f2595912269353d77755: Fixed bugs of safe validator for entryPoint 0.7
- 51dc53e2f67b4dec7957f2595912269353d77755: Added a debug flag to deploy simulations contract at startup

## 0.0.3

### Patch Changes

- db91de843ffacfb00fe92dcc690c4c2ffc8fcb2d: Added block-tag-support-disabled flag

## 0.0.2

### Patch Changes

- 044d62dbb6545d314c1e733bbd4dda5bbe4010b8: Log userOperation fields when rejected
- c68d7f52719153a23f6362a687d219e1c77ac9e2: First releaseof alto bundler
