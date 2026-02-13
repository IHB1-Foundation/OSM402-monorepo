// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IIssueEscrow} from "./interfaces/IIssueEscrow.sol";

/// @title IssueEscrow - Per-issue escrow holding funds for bounty payouts
/// @notice Holds funds and releases them upon valid mandate verification
contract IssueEscrow is IIssueEscrow {
    // =============================================================
    //                           CONSTANTS
    // =============================================================

    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "Intent(uint256 chainId,bytes32 repoKeyHash,uint256 issueNumber,address asset,uint256 cap,uint256 expiry,bytes32 policyHash,uint256 nonce)"
    );

    bytes32 public constant CART_TYPEHASH = keccak256(
        "Cart(bytes32 intentHash,bytes32 mergeSha,uint256 prNumber,address recipient,uint256 amount,uint256 nonce)"
    );

    // =============================================================
    //                           STORAGE
    // =============================================================

    /// @notice The ERC20 asset held in escrow
    address public immutable asset;

    /// @notice Maximum payout cap
    uint256 public immutable cap;

    /// @notice Expiry timestamp
    uint256 public immutable expiry;

    /// @notice Policy hash binding
    bytes32 public immutable policyHash;

    /// @notice Maintainer signer (authorizes intent)
    address public immutable maintainerSigner;

    /// @notice Agent signer (authorizes cart)
    address public immutable agentSigner;

    /// @notice Repository key hash
    bytes32 public immutable repoKeyHash;

    /// @notice Issue number
    uint256 public immutable issueNumber;

    /// @notice EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice Whether payout has occurred
    bool public paid;

    /// @notice Used intent nonces (replay protection)
    mapping(uint256 => bool) public usedIntentNonces;

    /// @notice Used cart nonces (replay protection)
    mapping(uint256 => bool) public usedCartNonces;

    /// @notice Reentrancy guard
    uint256 private _locked = 1;

    // =============================================================
    //                           ERRORS
    // =============================================================

    error AlreadyPaid();
    error Expired();
    error InvalidIntentSignature();
    error InvalidCartSignature();
    error IntentNonceUsed();
    error CartNonceUsed();
    error AmountExceedsCap();
    error InvalidIntentHash();
    error PolicyMismatch();
    error ChainMismatch();
    error RepoMismatch();
    error IssueMismatch();
    error AssetMismatch();
    error Reentrancy();
    error InsufficientBalance();

    // =============================================================
    //                           MODIFIERS
    // =============================================================

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    // =============================================================
    //                         CONSTRUCTOR
    // =============================================================

    constructor(
        address _asset,
        uint256 _cap,
        uint256 _expiry,
        bytes32 _policyHash,
        address _maintainerSigner,
        address _agentSigner,
        bytes32 _repoKeyHash,
        uint256 _issueNumber
    ) {
        asset = _asset;
        cap = _cap;
        expiry = _expiry;
        policyHash = _policyHash;
        maintainerSigner = _maintainerSigner;
        agentSigner = _agentSigner;
        repoKeyHash = _repoKeyHash;
        issueNumber = _issueNumber;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("OSM402"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    // =============================================================
    //                        EXTERNAL FUNCTIONS
    // =============================================================

    /// @inheritdoc IIssueEscrow
    function release(
        Intent calldata intent,
        bytes calldata intentSig,
        Cart calldata cart,
        bytes calldata cartSig
    ) external nonReentrant {
        // Check not already paid
        if (paid) revert AlreadyPaid();

        // Check expiry
        if (block.timestamp > expiry) revert Expired();

        // Verify intent matches escrow parameters
        if (intent.chainId != block.chainid) revert ChainMismatch();
        if (intent.repoKeyHash != repoKeyHash) revert RepoMismatch();
        if (intent.issueNumber != issueNumber) revert IssueMismatch();
        if (intent.asset != asset) revert AssetMismatch();
        if (intent.policyHash != policyHash) revert PolicyMismatch();
        if (intent.cap != cap) revert AmountExceedsCap();
        if (intent.expiry != expiry) revert Expired();

        // Check nonces
        if (usedIntentNonces[intent.nonce]) revert IntentNonceUsed();
        if (usedCartNonces[cart.nonce]) revert CartNonceUsed();

        // Compute and verify intent hash + signature
        bytes32 intentHash = hashIntent(intent);
        if (!_verifySignature(intentHash, intentSig, maintainerSigner)) {
            revert InvalidIntentSignature();
        }

        // Verify cart references correct intent
        if (cart.intentHash != intentHash) revert InvalidIntentHash();

        // Check amount within cap
        if (cart.amount > cap) revert AmountExceedsCap();

        // Verify cart signature
        bytes32 cartHash = hashCart(cart);
        if (!_verifySignature(cartHash, cartSig, agentSigner)) {
            revert InvalidCartSignature();
        }

        // Check sufficient balance
        uint256 currentBalance = IERC20(asset).balanceOf(address(this));
        if (currentBalance < cart.amount) revert InsufficientBalance();

        // Mark as paid and nonces as used
        paid = true;
        usedIntentNonces[intent.nonce] = true;
        usedCartNonces[cart.nonce] = true;

        // Transfer funds to recipient
        _safeTransfer(asset, cart.recipient, cart.amount);

        emit Released(cart.amount, cart.recipient, cartHash, intentHash, cart.mergeSha);
    }

    /// @inheritdoc IIssueEscrow
    function balance() external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    /// @inheritdoc IIssueEscrow
    function isPaid() external view returns (bool) {
        return paid;
    }

    // =============================================================
    //                        PUBLIC FUNCTIONS
    // =============================================================

    /// @notice Hash an intent for EIP-712 signing
    function hashIntent(Intent calldata intent) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        INTENT_TYPEHASH,
                        intent.chainId,
                        intent.repoKeyHash,
                        intent.issueNumber,
                        intent.asset,
                        intent.cap,
                        intent.expiry,
                        intent.policyHash,
                        intent.nonce
                    )
                )
            )
        );
    }

    /// @notice Hash a cart for EIP-712 signing
    function hashCart(Cart calldata cart) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        CART_TYPEHASH,
                        cart.intentHash,
                        cart.mergeSha,
                        cart.prNumber,
                        cart.recipient,
                        cart.amount,
                        cart.nonce
                    )
                )
            )
        );
    }

    // =============================================================
    //                       INTERNAL FUNCTIONS
    // =============================================================

    /// @dev Verify ECDSA signature
    function _verifySignature(
        bytes32 digest,
        bytes calldata signature,
        address expectedSigner
    ) internal pure returns (bool) {
        if (signature.length != 65) return false;

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) v += 27;

        address recovered = ecrecover(digest, v, r, s);
        return recovered != address(0) && recovered == expectedSigner;
    }

    /// @dev Safe ERC20 transfer
    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
    }
}
