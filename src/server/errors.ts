/*
code: -32602 - invalid UserOperation struct/fields
code: -32500 - transaction rejected by entryPoint’s simulateValidation, during wallet creation or validation
The message field MUST be set to the FailedOp’s “AAxx” error message from the EntryPoint
code: -32501 - transaction rejected by paymaster’s validatePaymasterUserOp
The message field SHOULD be set to the revert message from the paymaster
The data field MUST contain a paymaster value
code: -32502 - transaction rejected because of opcode validation
code: -32503 - UserOperation out of time-range: either wallet or paymaster returned a time-range, and it is already expired (or will expire soon)
The data field SHOULD contain the validUntil and validAfter values
The data field SHOULD contain a paymaster value, if this error was triggered by the paymaster
code: -32504 - transaction rejected because paymaster (or signature aggregator) is throttled/banned
The data field SHOULD contain a paymaster or aggregator value, depending on the failed entity
code: -32505 - transaction rejected because paymaster (or signature aggregator) stake or unstake-delay is too low
The data field SHOULD contain a paymaster or aggregator value, depending on the failed entity
The data field SHOULD contain a minimumStake and minimumUnstakeDelay
code: -32506 - transaction rejected because wallet specified unsupported signature aggregator
The data field SHOULD contain an aggregator value
*/
