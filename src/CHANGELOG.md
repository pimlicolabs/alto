# @pimlico/alto

## 0.0.5

### Patch Changes

- c1775902ead108325c2c3bef81535a53ba092311: Fixed bug where gas estimate is too low leading to the bundling tx reverting onchain due to AA95

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
