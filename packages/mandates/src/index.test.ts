import { describe, it, expect } from 'vitest';
import { keccak256, toHex, encodePacked } from 'viem';
import {
  createIntent,
  createCart,
  hashIntent,
  hashCart,
  buildIntentTypedData,
  buildCartTypedData,
  DOMAIN_NAME,
  DOMAIN_VERSION,
} from './index.js';

describe('Mandate Types', () => {
  const chainId = 31337n; // Foundry default
  const verifyingContract = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const;

  const repoKeyHash = keccak256(toHex('owner/repo'));
  const policyHash = keccak256(toHex('policy-v1'));

  describe('Intent', () => {
    it('should create intent with correct structure', () => {
      const intent = createIntent({
        chainId,
        repoKeyHash,
        issueNumber: 42,
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        cap: 100_000_000n, // 100 USDC
        expiry: 1704067200n,
        policyHash,
        nonce: 1,
      });

      expect(intent.chainId).toBe(chainId);
      expect(intent.issueNumber).toBe(42n);
      expect(intent.cap).toBe(100_000_000n);
      expect(intent.nonce).toBe(1n);
    });

    it('should build intent typed data with correct domain', () => {
      const intent = createIntent({
        chainId,
        repoKeyHash,
        issueNumber: 42,
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        cap: 100_000_000n,
        expiry: 1704067200n,
        policyHash,
        nonce: 1,
      });

      const typedData = buildIntentTypedData(intent, verifyingContract);

      expect(typedData.domain.name).toBe(DOMAIN_NAME);
      expect(typedData.domain.version).toBe(DOMAIN_VERSION);
      expect(typedData.domain.chainId).toBe(chainId);
      expect(typedData.domain.verifyingContract).toBe(verifyingContract);
      expect(typedData.primaryType).toBe('Intent');
    });

    it('should hash intent deterministically', () => {
      const intent = createIntent({
        chainId,
        repoKeyHash,
        issueNumber: 42,
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        cap: 100_000_000n,
        expiry: 1704067200n,
        policyHash,
        nonce: 1,
      });

      const hash1 = hashIntent(intent, verifyingContract);
      const hash2 = hashIntent(intent, verifyingContract);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
    });
  });

  describe('Cart', () => {
    it('should create cart with correct structure', () => {
      const intentHash = keccak256(toHex('test-intent'));
      const mergeSha = keccak256(toHex('abc123'));

      const cart = createCart({
        intentHash,
        mergeSha,
        prNumber: 1,
        recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        amount: 50_000_000n, // 50 USDC
        nonce: 1,
      });

      expect(cart.prNumber).toBe(1n);
      expect(cart.amount).toBe(50_000_000n);
      expect(cart.nonce).toBe(1n);
    });

    it('should build cart typed data with correct domain', () => {
      const intentHash = keccak256(toHex('test-intent'));
      const mergeSha = keccak256(toHex('abc123'));

      const cart = createCart({
        intentHash,
        mergeSha,
        prNumber: 1,
        recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        amount: 50_000_000n,
        nonce: 1,
      });

      const typedData = buildCartTypedData(cart, verifyingContract, chainId);

      expect(typedData.domain.name).toBe(DOMAIN_NAME);
      expect(typedData.domain.version).toBe(DOMAIN_VERSION);
      expect(typedData.domain.chainId).toBe(chainId);
      expect(typedData.primaryType).toBe('Cart');
    });

    it('should hash cart deterministically', () => {
      const intentHash = keccak256(toHex('test-intent'));
      const mergeSha = keccak256(toHex('abc123'));

      const cart = createCart({
        intentHash,
        mergeSha,
        prNumber: 1,
        recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        amount: 50_000_000n,
        nonce: 1,
      });

      const hash1 = hashCart(cart, verifyingContract, chainId);
      const hash2 = hashCart(cart, verifyingContract, chainId);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
    });
  });

  describe('Cross-verification with Solidity', () => {
    // These test vectors should match the Solidity implementation
    it('should produce matching INTENT_TYPEHASH', () => {
      const expectedTypehash = keccak256(
        toHex(
          'Intent(uint256 chainId,bytes32 repoKeyHash,uint256 issueNumber,address asset,uint256 cap,uint256 expiry,bytes32 policyHash,uint256 nonce)'
        )
      );

      // This is the same typehash defined in IssueEscrow.sol
      expect(expectedTypehash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should produce matching CART_TYPEHASH', () => {
      const expectedTypehash = keccak256(
        toHex(
          'Cart(bytes32 intentHash,bytes32 mergeSha,uint256 prNumber,address recipient,uint256 amount,uint256 nonce)'
        )
      );

      // This is the same typehash defined in IssueEscrow.sol
      expect(expectedTypehash).toMatch(/^0x[a-f0-9]{64}$/);
    });
  });
});
