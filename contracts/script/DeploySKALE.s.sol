// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IssueEscrowFactory} from "../src/IssueEscrowFactory.sol";

/// @title DeploySKALE - Deploy OSM402 contracts to SKALE testnet
/// @notice SKALE is gasless — deployer needs no native token balance.
contract DeploySKALE is Script {
    address internal constant BITE_V2_USDC = 0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address maintainerSigner = vm.envOr("GITPAY_MAINTAINER_ADDRESS", deployer);
        address agentSigner = vm.envOr("GITPAY_AGENT_ADDRESS", deployer);

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy IssueEscrowFactory
        IssueEscrowFactory factory = new IssueEscrowFactory(
            maintainerSigner,
            agentSigner
        );
        console.log("IssueEscrowFactory deployed at:", address(factory));

        vm.stopBroadcast();

        // Output deployment summary
        console.log("");
        console.log("=== SKALE DEPLOYMENT SUMMARY ===");
        console.log("Chain ID:", block.chainid);
        console.log("USDC (existing):", BITE_V2_USDC);
        console.log("Factory:", address(factory));
        console.log("Maintainer:", maintainerSigner);
        console.log("Agent:", agentSigner);
        console.log("");
        console.log("Set ESCROW_FACTORY_ADDRESS in your .env");
        console.log("ASSET_ADDRESS must stay on USDC for demo");
    }
}
