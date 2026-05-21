// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { PimlicoSimulations } from "../src/PimlicoSimulations.sol";
import { EntryPointSimulations08 } from "../src/v08/EntryPointSimulations.sol";
import { HelperConfig } from "./HelperConfig.s.sol";
import { Script, console2 } from "forge-std/Script.sol";
import { SafeSingletonDeployer } from "safe-singleton-deployer-sol/src/SafeSingletonDeployer.sol";

contract DeploySimulations is Script {

    // Paste these in after the first preview/deploy. address(0) skips the assertion.
    address constant EXPECTED_PIMLICO_SIMULATIONS = address(0);
    address constant EXPECTED_EP_SIMULATIONS_08 = address(0);

    bytes32 constant PIMLICO_SIMULATIONS_SALT = 0x0000000000000000000000000000000000000000000000000000000000000001;
    bytes32 constant EP_SIMULATIONS_08_SALT = 0x0000000000000000000000000000000000000000000000000000000000000002;

    function run() external returns (PimlicoSimulations, EntryPointSimulations08, HelperConfig.NetworkConfig memory) {
        HelperConfig helperConfig = new HelperConfig();
        HelperConfig.NetworkConfig memory config = helperConfig.getConfig();

        console2.log("Deploying on chain ID", block.chainid);
        console2.log("Target EntryPoint    ", config.entryPointAddress);

        address pimlicoSimulations;
        address epSimulations08;

        if (block.chainid == helperConfig.LOCAL_CHAIN_ID()) {
            vm.startBroadcast();
            pimlicoSimulations = address(new PimlicoSimulations());
            epSimulations08 = address(new EntryPointSimulations08());
            vm.stopBroadcast();
        } else {
            pimlicoSimulations = SafeSingletonDeployer.broadcastDeploy({
                creationCode: type(PimlicoSimulations).creationCode,
                salt: PIMLICO_SIMULATIONS_SALT
            });

            console2.log("PimlicoSimulations", pimlicoSimulations);
            assert(pimlicoSimulations == EXPECTED_PIMLICO_SIMULATIONS || EXPECTED_PIMLICO_SIMULATIONS == address(0));

            epSimulations08 = SafeSingletonDeployer.broadcastDeploy({
                creationCode: type(EntryPointSimulations08).creationCode,
                salt: EP_SIMULATIONS_08_SALT
            });

            console2.log("EntryPointSimulations08", epSimulations08);
            assert(epSimulations08 == EXPECTED_EP_SIMULATIONS_08 || EXPECTED_EP_SIMULATIONS_08 == address(0));
        }

        console2.log("");
        console2.log("Skandha config:");
        console2.log("  pimlicoSimulationsContract:", pimlicoSimulations);
        console2.log("  epSimulationsContract:    ", epSimulations08);

        return (
            PimlicoSimulations(pimlicoSimulations),
            EntryPointSimulations08(payable(epSimulations08)),
            config
        );
    }

}
