#!/bin/bash

# set -e

source .env

# Split the CHAIN_KEYS variable by comma, then iterate over each pair
IFS=',' read -r -a pairs <<< "$CHAIN_KEYS"
for pair in "${pairs[@]}"; do
  # Split each pair by '='
  
  IFS=';' read -r -a kv <<< "$pair"
  ETHERSCAN_KEY="${kv[0]}"
  ETHERSCAN_URL="${kv[1]}"

  # Verify contracts only if ETHERSCAN_KEY and ETHERSCAN_URL are provided
  if [[ -n "$ETHERSCAN_KEY" && -n "$ETHERSCAN_URL" ]]; then
    echo "Verifying with $ETHERSCAN_URL using key $ETHERSCAN_KEY"

    forge verify-contract 0x781c949866709CaF3456c1442f199237AB77A228 src/v07/PimlicoEntryPointSimulationsV7.sol:PimlicoEntryPointSimulationsV7 \
      --verifier-url "$ETHERSCAN_URL" \
      --etherscan-api-key "$ETHERSCAN_KEY"

    forge verify-contract 0xabee97b2abc03839a8219cb68f148b893b51129d src/v07/EntryPointSimulations.sol:EntryPointSimulations \
      --verifier-url "$ETHERSCAN_URL" \
      --etherscan-api-key "$ETHERSCAN_KEY"
      

    forge verify-contract 0xEb2EA757CaAa889Cb212fdb90caa395DaC528EdF src/v08/PimlicoEntryPointSimulationsV8.sol:PimlicoEntryPointSimulationsV8 \
      --verifier-url "$ETHERSCAN_URL" \
      --etherscan-api-key "$ETHERSCAN_KEY"

    forge verify-contract 0x3f508e779aaa33ee222f971ae081235b52f848b3 src/v08/EntryPointSimulations.sol:EntryPointSimulations \
      --verifier-url "$ETHERSCAN_URL" \
      --etherscan-api-key "$ETHERSCAN_KEY"

  else
    echo "Skipping contract verification as ETHERSCAN_KEY and/or ETHERSCAN_URL are not provided."
  fi
done

