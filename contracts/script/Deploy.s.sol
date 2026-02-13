// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IssueEscrowFactory} from "../src/IssueEscrowFactory.sol";

/// @title Deploy - Deployment script for OSM402 contracts
/// @notice Deploys IssueEscrowFactory to an EVM testnet configured by RPC
contract Deploy is Script {
    // Default signers for MVP demo - should be configured via env in production
    address constant DEFAULT_MAINTAINER = address(0x1);
    address constant DEFAULT_AGENT = address(0x2);

    function setUp() public {}

    function run() public {
        // Load deployer private key from environment
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Load signer addresses from environment, with defaults
        address maintainerSigner = vm.envOr("OSM402_MAINTAINER_ADDRESS", deployer);
        address agentSigner = vm.envOr("OSM402_AGENT_ADDRESS", deployer);

        console.log("Deployer:", deployer);
        console.log("Maintainer Signer:", maintainerSigner);
        console.log("Agent Signer:", agentSigner);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy IssueEscrowFactory
        IssueEscrowFactory factory = new IssueEscrowFactory(
            maintainerSigner,
            agentSigner
        );

        console.log("IssueEscrowFactory deployed at:", address(factory));

        vm.stopBroadcast();

        // Output deployment info for address registry
        console.log("");
        console.log("=== DEPLOYMENT SUMMARY ===");
        console.log("Chain ID:", block.chainid);
        console.log("Factory Address:", address(factory));
        console.log("Maintainer Signer:", maintainerSigner);
        console.log("Agent Signer:", agentSigner);
        console.log("");
        console.log("Save addresses to the appropriate config/chains/<network>.json");
    }
}

/// @title DeployLocal - Deployment script for local testing
/// @notice Deploys to local anvil/hardhat node
contract DeployLocal is Script {
    function run() public {
        // Use default anvil private key for local testing
        uint256 deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Local Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // Use deployer as both signers for local testing
        IssueEscrowFactory factory = new IssueEscrowFactory(deployer, deployer);

        console.log("IssueEscrowFactory deployed at:", address(factory));

        vm.stopBroadcast();
    }
}
