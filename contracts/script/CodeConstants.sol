// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

abstract contract CodeConstants {

    uint256 public constant LOCAL_CHAIN_ID = 31_337;

    uint256 public constant MAINNET_ETH_CHAIN_ID = 1;
    uint256 public constant ETH_SEPOLIA_CHAIN_ID = 11_155_111;

    uint256 public constant BASE_CHAIN_ID = 8453;
    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;

    uint256 public constant OPTIMISM_CHAIN_ID = 10;
    uint256 public constant OPTIMISM_SEPOLIA_CHAIN_ID = 11_155_420;

    uint256 public constant ARBITRUM_ONE_CHAIN_ID = 42_161;
    uint256 public constant ARBITRUM_SEPOLIA_CHAIN_ID = 421_614;

    uint256 public constant AVALANCHE_CHAIN_ID = 43_114;
    uint256 public constant AVALANCHE_FUJI_CHAIN_ID = 43_113;

    uint256 public constant BSC_CHAIN_ID = 56;
    uint256 public constant BSC_TESTNET_CHAIN_ID = 97;

    uint256 public constant LINEA_CHAIN_ID = 59_144;
    uint256 public constant LINEA_SEPOLIA_CHAIN_ID = 59_141;

    uint256 public constant CELO_CHAIN_ID = 42_220;
    uint256 public constant CELO_SEPOLIA_CHAIN_ID = 11_142_220;

    uint256 public constant FLARE_CHAIN_ID = 14;
    uint256 public constant FLARE_COSTON2_CHAIN_ID = 114;

    uint256 public constant INK_CHAIN_ID = 57_073;
    uint256 public constant INK_SEPOLIA_CHAIN_ID = 763_373;

    uint256 public constant DOS_CHAIN_ID = 7979;

    uint256 public constant GNOSIS_CHAIN_ID = 100;

    uint256 public constant ARC_TESTNET_CHAIN_ID = 5_042_002;

    // Address of the v0.8 EntryPoint contract
    address public constant ENTRYPOINT_ADDRESS = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

}
