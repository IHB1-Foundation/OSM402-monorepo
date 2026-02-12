// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IssueEscrow} from "./IssueEscrow.sol";

/// @title IssueEscrowFactory - Factory for deploying per-issue escrows via CREATE2
/// @notice Deploys IssueEscrow contracts deterministically based on repo/issue/policy
contract IssueEscrowFactory {
    // =============================================================
    //                           EVENTS
    // =============================================================

    /// @notice Emitted when a new escrow is created
    event EscrowCreated(
        bytes32 indexed issueKeyHash,
        address escrowAddress,
        bytes32 policyHash,
        address asset,
        uint256 cap,
        uint256 expiry
    );

    // =============================================================
    //                           STORAGE
    // =============================================================

    /// @notice Mapping from issueKeyHash to escrow address
    mapping(bytes32 => address) public escrows;

    /// @notice Default maintainer signer (can be overridden per escrow)
    address public immutable defaultMaintainerSigner;

    /// @notice Default agent signer (can be overridden per escrow)
    address public immutable defaultAgentSigner;

    // =============================================================
    //                           ERRORS
    // =============================================================

    error EscrowAlreadyExists();
    error InvalidAsset();
    error InvalidCap();
    error InvalidExpiry();
    error InvalidSigner();

    // =============================================================
    //                         CONSTRUCTOR
    // =============================================================

    constructor(address _defaultMaintainerSigner, address _defaultAgentSigner) {
        if (_defaultMaintainerSigner == address(0)) revert InvalidSigner();
        if (_defaultAgentSigner == address(0)) revert InvalidSigner();

        defaultMaintainerSigner = _defaultMaintainerSigner;
        defaultAgentSigner = _defaultAgentSigner;
    }

    // =============================================================
    //                        EXTERNAL FUNCTIONS
    // =============================================================

    /// @notice Create a new escrow for an issue
    /// @param repoKeyHash Hash of the repository key (owner/repo)
    /// @param issueNumber The issue number
    /// @param policyHash Hash of the .gitpay.yml policy
    /// @param asset ERC20 token address
    /// @param cap Maximum payout cap
    /// @param expiry Expiry timestamp
    /// @return escrow The address of the created escrow
    function createEscrow(
        bytes32 repoKeyHash,
        uint256 issueNumber,
        bytes32 policyHash,
        address asset,
        uint256 cap,
        uint256 expiry
    ) external returns (address escrow) {
        return createEscrowWithSigners(
            repoKeyHash,
            issueNumber,
            policyHash,
            asset,
            cap,
            expiry,
            defaultMaintainerSigner,
            defaultAgentSigner
        );
    }

    /// @notice Create a new escrow with custom signers
    /// @param repoKeyHash Hash of the repository key (owner/repo)
    /// @param issueNumber The issue number
    /// @param policyHash Hash of the .gitpay.yml policy
    /// @param asset ERC20 token address
    /// @param cap Maximum payout cap
    /// @param expiry Expiry timestamp
    /// @param maintainerSigner Custom maintainer signer
    /// @param agentSigner Custom agent signer
    /// @return escrow The address of the created escrow
    function createEscrowWithSigners(
        bytes32 repoKeyHash,
        uint256 issueNumber,
        bytes32 policyHash,
        address asset,
        uint256 cap,
        uint256 expiry,
        address maintainerSigner,
        address agentSigner
    ) public returns (address escrow) {
        // Validate inputs
        if (asset == address(0)) revert InvalidAsset();
        if (cap == 0) revert InvalidCap();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (maintainerSigner == address(0)) revert InvalidSigner();
        if (agentSigner == address(0)) revert InvalidSigner();

        // Compute issue key hash for uniqueness
        bytes32 issueKeyHash = keccak256(abi.encodePacked(repoKeyHash, issueNumber));

        // Check escrow doesn't already exist
        if (escrows[issueKeyHash] != address(0)) revert EscrowAlreadyExists();

        // Compute CREATE2 salt
        bytes32 salt = computeSalt(repoKeyHash, issueNumber, policyHash);

        // Deploy escrow via CREATE2
        escrow = address(
            new IssueEscrow{salt: salt}(
                asset,
                cap,
                expiry,
                policyHash,
                maintainerSigner,
                agentSigner,
                repoKeyHash,
                issueNumber
            )
        );

        // Store mapping
        escrows[issueKeyHash] = escrow;

        emit EscrowCreated(issueKeyHash, escrow, policyHash, asset, cap, expiry);
    }

    /// @notice Compute the deterministic address for an escrow
    /// @param repoKeyHash Hash of the repository key
    /// @param issueNumber The issue number
    /// @param policyHash Hash of the policy
    /// @param asset ERC20 token address
    /// @param cap Maximum payout cap
    /// @param expiry Expiry timestamp
    /// @param maintainerSigner Maintainer signer address
    /// @param agentSigner Agent signer address
    /// @return The predicted escrow address
    function computeEscrowAddress(
        bytes32 repoKeyHash,
        uint256 issueNumber,
        bytes32 policyHash,
        address asset,
        uint256 cap,
        uint256 expiry,
        address maintainerSigner,
        address agentSigner
    ) external view returns (address) {
        bytes32 salt = computeSalt(repoKeyHash, issueNumber, policyHash);

        bytes32 bytecodeHash = keccak256(
            abi.encodePacked(
                type(IssueEscrow).creationCode,
                abi.encode(
                    asset,
                    cap,
                    expiry,
                    policyHash,
                    maintainerSigner,
                    agentSigner,
                    repoKeyHash,
                    issueNumber
                )
            )
        );

        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), address(this), salt, bytecodeHash)
                    )
                )
            )
        );
    }

    /// @notice Get escrow address for an issue
    /// @param repoKeyHash Hash of the repository key
    /// @param issueNumber The issue number
    /// @return The escrow address, or address(0) if not created
    function getEscrow(bytes32 repoKeyHash, uint256 issueNumber) external view returns (address) {
        bytes32 issueKeyHash = keccak256(abi.encodePacked(repoKeyHash, issueNumber));
        return escrows[issueKeyHash];
    }

    // =============================================================
    //                        PUBLIC FUNCTIONS
    // =============================================================

    /// @notice Compute the CREATE2 salt for an escrow
    /// @param repoKeyHash Hash of the repository key
    /// @param issueNumber The issue number
    /// @param policyHash Hash of the policy
    /// @return The salt value
    function computeSalt(
        bytes32 repoKeyHash,
        uint256 issueNumber,
        bytes32 policyHash
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(repoKeyHash, issueNumber, policyHash));
    }
}
