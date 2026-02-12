// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IIssueEscrow - Interface for issue escrow contracts
interface IIssueEscrow {
    /// @notice Emitted when funds are deposited into the escrow
    event Funded(uint256 amount, address indexed funder);

    /// @notice Emitted when funds are released to a recipient
    event Released(
        uint256 amount,
        address indexed recipient,
        bytes32 cartHash,
        bytes32 intentHash,
        bytes32 mergeSha
    );

    /// @notice Intent mandate struct - maintainer-authorized spending limit
    struct Intent {
        uint256 chainId;
        bytes32 repoKeyHash;
        uint256 issueNumber;
        address asset;
        uint256 cap;
        uint256 expiry;
        bytes32 policyHash;
        uint256 nonce;
    }

    /// @notice Cart mandate struct - agent-authorized specific payment
    struct Cart {
        bytes32 intentHash;
        bytes32 mergeSha;
        uint256 prNumber;
        address recipient;
        uint256 amount;
        uint256 nonce;
    }

    /// @notice Release funds from escrow with valid mandates
    /// @param intent The intent mandate
    /// @param intentSig The maintainer's signature over the intent
    /// @param cart The cart mandate
    /// @param cartSig The agent's signature over the cart
    function release(
        Intent calldata intent,
        bytes calldata intentSig,
        Cart calldata cart,
        bytes calldata cartSig
    ) external;

    /// @notice Get the escrow's funded balance
    function balance() external view returns (uint256);

    /// @notice Check if the escrow has been paid out
    function isPaid() external view returns (bool);
}
