// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IssueEscrowFactory} from "../src/IssueEscrowFactory.sol";
import {IssueEscrow} from "../src/IssueEscrow.sol";
import {IIssueEscrow} from "../src/interfaces/IIssueEscrow.sol";

/// @title MockERC20 - Simple mock token for testing
contract MockERC20 {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8 public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract IssueEscrowTest is Test {
    IssueEscrowFactory public factory;
    MockERC20 public token;

    address public maintainer;
    uint256 public maintainerPk;
    address public agent;
    uint256 public agentPk;
    address public recipient;

    bytes32 public repoKeyHash;
    uint256 public issueNumber;
    bytes32 public policyHash;
    uint256 public cap;
    uint256 public expiry;

    function setUp() public {
        // Create signers
        (maintainer, maintainerPk) = makeAddrAndKey("maintainer");
        (agent, agentPk) = makeAddrAndKey("agent");
        recipient = makeAddr("recipient");

        // Deploy mock token
        token = new MockERC20();

        // Deploy factory
        factory = new IssueEscrowFactory(maintainer, agent);

        // Set up test parameters
        repoKeyHash = keccak256("owner/repo");
        issueNumber = 42;
        policyHash = keccak256("policy-v1");
        cap = 100 * 1e6; // 100 USDC
        expiry = block.timestamp + 30 days;
    }

    function test_FactoryDeployment() public view {
        assertEq(factory.defaultMaintainerSigner(), maintainer);
        assertEq(factory.defaultAgentSigner(), agent);
    }

    function test_CreateEscrow() public {
        address escrowAddr = factory.createEscrow(
            repoKeyHash,
            issueNumber,
            policyHash,
            address(token),
            cap,
            expiry
        );

        assertTrue(escrowAddr != address(0));

        IssueEscrow escrow = IssueEscrow(escrowAddr);
        assertEq(escrow.asset(), address(token));
        assertEq(escrow.cap(), cap);
        assertEq(escrow.expiry(), expiry);
        assertEq(escrow.policyHash(), policyHash);
        assertEq(escrow.maintainerSigner(), maintainer);
        assertEq(escrow.agentSigner(), agent);
        assertEq(escrow.repoKeyHash(), repoKeyHash);
        assertEq(escrow.issueNumber(), issueNumber);
        assertFalse(escrow.isPaid());
    }

    function test_CreateEscrow_Deterministic() public {
        // Predict address before creation
        address predicted = factory.computeEscrowAddress(
            repoKeyHash,
            issueNumber,
            policyHash,
            address(token),
            cap,
            expiry,
            maintainer,
            agent
        );

        // Create escrow
        address actual = factory.createEscrow(
            repoKeyHash,
            issueNumber,
            policyHash,
            address(token),
            cap,
            expiry
        );

        assertEq(actual, predicted, "Escrow address should be deterministic");
    }

    function test_CreateEscrow_RevertOnDuplicate() public {
        factory.createEscrow(
            repoKeyHash,
            issueNumber,
            policyHash,
            address(token),
            cap,
            expiry
        );

        vm.expectRevert(IssueEscrowFactory.EscrowAlreadyExists.selector);
        factory.createEscrow(
            repoKeyHash,
            issueNumber,
            policyHash,
            address(token),
            cap,
            expiry
        );
    }

    function test_GetEscrow() public {
        address escrowAddr = factory.createEscrow(
            repoKeyHash,
            issueNumber,
            policyHash,
            address(token),
            cap,
            expiry
        );

        address retrieved = factory.getEscrow(repoKeyHash, issueNumber);
        assertEq(retrieved, escrowAddr);
    }

    function test_EscrowBalance() public {
        address escrowAddr = factory.createEscrow(
            repoKeyHash,
            issueNumber,
            policyHash,
            address(token),
            cap,
            expiry
        );

        IssueEscrow escrow = IssueEscrow(escrowAddr);

        // Initially zero
        assertEq(escrow.balance(), 0);

        // Fund the escrow
        token.mint(escrowAddr, 50 * 1e6);
        assertEq(escrow.balance(), 50 * 1e6);
    }

    function test_Release() public {
        // Create and fund escrow
        address escrowAddr = factory.createEscrow(
            repoKeyHash,
            issueNumber,
            policyHash,
            address(token),
            cap,
            expiry
        );

        IssueEscrow escrow = IssueEscrow(escrowAddr);
        token.mint(escrowAddr, cap);

        // Create intent
        IIssueEscrow.Intent memory intent = IIssueEscrow.Intent({
            chainId: block.chainid,
            repoKeyHash: repoKeyHash,
            issueNumber: issueNumber,
            asset: address(token),
            cap: cap,
            expiry: expiry,
            policyHash: policyHash,
            nonce: 1
        });

        // Sign intent
        bytes32 intentHash = escrow.hashIntent(intent);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(maintainerPk, intentHash);
        bytes memory intentSig = abi.encodePacked(r1, s1, v1);

        // Create cart
        uint256 payoutAmount = 50 * 1e6;
        bytes32 mergeSha = keccak256("abc123");

        IIssueEscrow.Cart memory cart = IIssueEscrow.Cart({
            intentHash: intentHash,
            mergeSha: mergeSha,
            prNumber: 1,
            recipient: recipient,
            amount: payoutAmount,
            nonce: 1
        });

        // Sign cart
        bytes32 cartHash = escrow.hashCart(cart);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(agentPk, cartHash);
        bytes memory cartSig = abi.encodePacked(r2, s2, v2);

        // Execute release
        escrow.release(intent, intentSig, cart, cartSig);

        // Verify state
        assertTrue(escrow.isPaid());
        assertEq(token.balanceOf(recipient), payoutAmount);
        assertEq(escrow.balance(), cap - payoutAmount);
    }

    function test_Release_RevertOnDoublePay() public {
        // Create and fund escrow
        address escrowAddr = factory.createEscrow(
            repoKeyHash,
            issueNumber,
            policyHash,
            address(token),
            cap,
            expiry
        );

        IssueEscrow escrow = IssueEscrow(escrowAddr);
        token.mint(escrowAddr, cap);

        // Create intent
        IIssueEscrow.Intent memory intent = IIssueEscrow.Intent({
            chainId: block.chainid,
            repoKeyHash: repoKeyHash,
            issueNumber: issueNumber,
            asset: address(token),
            cap: cap,
            expiry: expiry,
            policyHash: policyHash,
            nonce: 1
        });

        bytes32 intentHash = escrow.hashIntent(intent);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(maintainerPk, intentHash);
        bytes memory intentSig = abi.encodePacked(r1, s1, v1);

        IIssueEscrow.Cart memory cart = IIssueEscrow.Cart({
            intentHash: intentHash,
            mergeSha: keccak256("abc123"),
            prNumber: 1,
            recipient: recipient,
            amount: 50 * 1e6,
            nonce: 1
        });

        bytes32 cartHash = escrow.hashCart(cart);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(agentPk, cartHash);
        bytes memory cartSig = abi.encodePacked(r2, s2, v2);

        // First release succeeds
        escrow.release(intent, intentSig, cart, cartSig);

        // Second release fails
        vm.expectRevert(IssueEscrow.AlreadyPaid.selector);
        escrow.release(intent, intentSig, cart, cartSig);
    }

    function test_Release_RevertOnExpired() public {
        // Create escrow
        address escrowAddr = factory.createEscrow(
            repoKeyHash,
            issueNumber,
            policyHash,
            address(token),
            cap,
            expiry
        );

        IssueEscrow escrow = IssueEscrow(escrowAddr);
        token.mint(escrowAddr, cap);

        // Warp past expiry
        vm.warp(expiry + 1);

        // Create mandates
        IIssueEscrow.Intent memory intent = IIssueEscrow.Intent({
            chainId: block.chainid,
            repoKeyHash: repoKeyHash,
            issueNumber: issueNumber,
            asset: address(token),
            cap: cap,
            expiry: expiry,
            policyHash: policyHash,
            nonce: 1
        });

        bytes32 intentHash = escrow.hashIntent(intent);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(maintainerPk, intentHash);
        bytes memory intentSig = abi.encodePacked(r1, s1, v1);

        IIssueEscrow.Cart memory cart = IIssueEscrow.Cart({
            intentHash: intentHash,
            mergeSha: keccak256("abc123"),
            prNumber: 1,
            recipient: recipient,
            amount: 50 * 1e6,
            nonce: 1
        });

        bytes32 cartHash = escrow.hashCart(cart);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(agentPk, cartHash);
        bytes memory cartSig = abi.encodePacked(r2, s2, v2);

        vm.expectRevert(IssueEscrow.Expired.selector);
        escrow.release(intent, intentSig, cart, cartSig);
    }

    function test_Release_RevertOnInvalidSignature() public {
        // Create and fund escrow
        address escrowAddr = factory.createEscrow(
            repoKeyHash,
            issueNumber,
            policyHash,
            address(token),
            cap,
            expiry
        );

        IssueEscrow escrow = IssueEscrow(escrowAddr);
        token.mint(escrowAddr, cap);

        // Create intent
        IIssueEscrow.Intent memory intent = IIssueEscrow.Intent({
            chainId: block.chainid,
            repoKeyHash: repoKeyHash,
            issueNumber: issueNumber,
            asset: address(token),
            cap: cap,
            expiry: expiry,
            policyHash: policyHash,
            nonce: 1
        });

        // Sign with wrong key (agent instead of maintainer)
        bytes32 intentHash = escrow.hashIntent(intent);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(agentPk, intentHash); // Wrong signer!
        bytes memory intentSig = abi.encodePacked(r1, s1, v1);

        IIssueEscrow.Cart memory cart = IIssueEscrow.Cart({
            intentHash: intentHash,
            mergeSha: keccak256("abc123"),
            prNumber: 1,
            recipient: recipient,
            amount: 50 * 1e6,
            nonce: 1
        });

        bytes32 cartHash = escrow.hashCart(cart);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(agentPk, cartHash);
        bytes memory cartSig = abi.encodePacked(r2, s2, v2);

        vm.expectRevert(IssueEscrow.InvalidIntentSignature.selector);
        escrow.release(intent, intentSig, cart, cartSig);
    }
}
