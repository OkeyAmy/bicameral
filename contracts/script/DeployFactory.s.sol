// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BicameralFactory} from "../src/BicameralFactory.sol";

/// @notice Deploys the factory, pointing at a pre-deployed implementation.
///
///   forge script script/DeployFactory.s.sol --sig "run()" --broadcast --rpc-url somnia_testnet
contract DeployFactory is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        address platform = vm.envAddress("SOMNIA_AGENTS");
        address collateral = vm.envAddress("COLLATERAL");
        address marketsModule = vm.envAddress("MARKETS_MODULE");
        uint256 llmAgentId = vm.envUint("LLM_INFERENCE_AGENT_ID");
        uint256 perAgentReward = vm.envOr("PER_AGENT_REWARD", uint256(0.07 ether));
        address impl = vm.envAddress("IMPLEMENTATION_ADDRESS");

        vm.startBroadcast(pk);

        BicameralFactory factory =
            new BicameralFactory(platform, collateral, marketsModule, llmAgentId, perAgentReward, impl);

        uint256 fuelGrant = vm.envOr("FUEL_GRANT", uint256(5 ether));
        uint256 collateralGrant = vm.envOr("COLLATERAL_GRANT", uint256(0));
        factory.setSponsorship(true, fuelGrant, collateralGrant);

        vm.stopBroadcast();

        console.log("factory        ", address(factory));
        console.log("implementation ", factory.implementation());
        console.log("");
        console.log("Add to .env:");
        console.log("FACTORY_ADDRESS=%s", address(factory));
    }
}
