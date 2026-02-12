// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IssueEscrowFactory} from "../src/IssueEscrowFactory.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @title DeploySKALE - Deploy GitPay contracts + MockUSDC to SKALE testnet
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

        // 1. Deploy MockUSDC (demo stablecoin)
        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC deployed at:", address(usdc));

        // 2. Mint initial supply to deployer (1,000,000 USDC)
        usdc.mint(deployer, 1_000_000 * 1e6);
        console.log("Minted 1,000,000 USDC to deployer");

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
        console.log("MockUSDC:", address(usdc));
        console.log("Factory:", address(factory));
        console.log("Maintainer:", maintainerSigner);
        console.log("Agent:", agentSigner);
        console.log("");
        console.log("Save addresses to apps/server/config/chains/skale-testnet.json");
    }
}
