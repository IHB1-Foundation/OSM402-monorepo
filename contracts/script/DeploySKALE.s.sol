// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IssueEscrowFactory} from "../src/IssueEscrowFactory.sol";
import {MockSKLA} from "../src/MockSKLA.sol";

/// @title DeploySKALE - Deploy GitPay contracts + MockSKLA to SKALE testnet
/// @notice SKALE is gasless — deployer needs no native token balance.
contract DeploySKALE is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address maintainerSigner = vm.envOr("GITPAY_MAINTAINER_ADDRESS", deployer);
        address agentSigner = vm.envOr("GITPAY_AGENT_ADDRESS", deployer);

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MockSKLA (demo asset)
        MockSKLA skla = new MockSKLA();
        console.log("MockSKLA deployed at:", address(skla));

        // 2. Mint initial supply to deployer (1,000,000 SKLA)
        skla.mint(deployer, 1_000_000 * 1e18);
        console.log("Minted 1,000,000 SKLA to deployer");

        // 3. Deploy IssueEscrowFactory
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
        console.log("MockSKLA:", address(skla));
        console.log("Factory:", address(factory));
        console.log("Maintainer:", maintainerSigner);
        console.log("Agent:", agentSigner);
        console.log("");
        console.log("Save addresses to apps/server/config/chains/skale-testnet.json");
    }
}
