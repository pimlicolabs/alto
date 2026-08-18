---
"@pimlico/alto": patch
---

New chains & features:

- Added Tempo chain support with ERC-20 balance transfers, and Citrea chain support with static L1 diff size configuration
- Added multi-RPC transaction sending
- Added horizontal scaling support: graceful shutdown, Redis-based distributed locking for gas price and wallet refills, Redis block cache, and batched wallet refills
- New CLI flags: gas ceiling flags, per-userOp gas limit, gas reward percentiles, block polling interval, dynamic gas price, gas price replacement threshold, max resubmits, and an `eip-7702-support` flag to reject 7702 userOps when disabled

EIP-7702 hardening:

- Reject high-s and invalid ECDSA signature components in 7702 authorizations
- Validate the factory field against 7702 requirements, pad short-form 0x7702 factories to 20 bytes when factoryData is present, and deduplicate authorization entries

Fixes & improvements:

- Use median instead of mean for gas price calculations and eliminate Redis timing drift with PTTL-based polling
- Cap wallet refills by utility balance and avoid empty batch refills
- Preserve `eth_call` sender, handle empty simulation bytes, and allow string JSON-RPC request IDs
- Reduced RPC usage and improved wallet/utility-balance metrics
