// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BicameralFactory} from "../src/BicameralFactory.sol";
import {BicameralTrader} from "../src/BicameralTrader.sol";

/// @notice Two-step deploy: implementation first, then factory.
///         Splits the gas across two transactions so neither exceeds
///         Somnia's block gas limit (~8.5M).
///
///   forge script script/Deploy.s.sol --sig "run()" --broadcast --rpc-url somnia_testnet
///
/// Nothing about the market universe is set here. Markets are registered later
/// from live discovery (`pnpm register`), never from a literal in this file.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        address platform = vm.envAddress("SOMNIA_AGENTS");
        address collateral = vm.envAddress("COLLATERAL");
        address marketsModule = vm.envAddress("MARKETS_MODULE");
        uint256 llmAgentId = vm.envUint("LLM_INFERENCE_AGENT_ID");

        // Per-agent price for LLM Inference, from the Somnia gas-fees table.
        // Sent on top of getAdvancedRequestDeposit(); anything unclaimed rebates.
        uint256 perAgentReward = vm.envOr("PER_AGENT_REWARD", uint256(0.07 ether));

        vm.startBroadcast(pk);

        // Step 1: deploy the implementation (the code every agent clone runs).
        BicameralTrader impl = new BicameralTrader();
        console.log("implementation ", address(impl));

        // Step 2: deploy the factory, pointing at the pre-deployed implementation.
        BicameralFactory factory = new BicameralFactory(
            platform, collateral, marketsModule, llmAgentId, perAgentReward, address(impl)
        );

        // Starter grant: a stranger with a wallet and no testnet funds must be
        // able to deploy without visiting a faucet.
        uint256 fuelGrant = vm.envOr("FUEL_GRANT", uint256(5 ether)); // ~20 decisions
        uint256 collateralGrant = vm.envOr("COLLATERAL_GRANT", uint256(0));
        factory.setSponsorship(true, fuelGrant, collateralGrant);

        vm.stopBroadcast();

        console.log("factory        ", address(factory));
        console.log("");
        console.log("Add to .env:");
        console.log("FACTORY_ADDRESS=%s", address(factory));
        console.log("IMPLEMENTATION_ADDRESS=%s", address(impl));
    }
}
