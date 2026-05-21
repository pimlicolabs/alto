// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { CodeConstants } from "./CodeConstants.sol";
import { Script, console2 } from "forge-std/Script.sol";

contract HelperConfig is CodeConstants, Script {

    error HelperConfig__InvalidChainId();

    struct NetworkConfig {
        address entryPointAddress;
    }

    function isSupportedChain(uint256 chainId) public pure returns (bool) {
        return chainId == ETH_SEPOLIA_CHAIN_ID || chainId == MAINNET_ETH_CHAIN_ID || chainId == BASE_CHAIN_ID
            || chainId == BASE_SEPOLIA_CHAIN_ID || chainId == OPTIMISM_CHAIN_ID || chainId == OPTIMISM_SEPOLIA_CHAIN_ID
            || chainId == ARBITRUM_ONE_CHAIN_ID || chainId == ARBITRUM_SEPOLIA_CHAIN_ID || chainId == AVALANCHE_CHAIN_ID
            || chainId == AVALANCHE_FUJI_CHAIN_ID || chainId == BSC_CHAIN_ID || chainId == BSC_TESTNET_CHAIN_ID
            || chainId == LINEA_CHAIN_ID || chainId == LINEA_SEPOLIA_CHAIN_ID || chainId == CELO_CHAIN_ID
            || chainId == CELO_SEPOLIA_CHAIN_ID || chainId == FLARE_CHAIN_ID || chainId == FLARE_COSTON2_CHAIN_ID
            || chainId == INK_CHAIN_ID || chainId == INK_SEPOLIA_CHAIN_ID || chainId == DOS_CHAIN_ID
            || chainId == GNOSIS_CHAIN_ID || chainId == ARC_TESTNET_CHAIN_ID;
    }

    function getConfigByChainId(uint256 chainId) public pure returns (NetworkConfig memory) {
        if (chainId == LOCAL_CHAIN_ID) {
            return NetworkConfig({ entryPointAddress: ENTRYPOINT_ADDRESS });
        } else if (isSupportedChain(chainId)) {
            return NetworkConfig({ entryPointAddress: ENTRYPOINT_ADDRESS });
        } else {
            revert HelperConfig__InvalidChainId();
        }
    }

    function getConfig() public view returns (NetworkConfig memory) {
        return getConfigByChainId(block.chainid);
    }

}
