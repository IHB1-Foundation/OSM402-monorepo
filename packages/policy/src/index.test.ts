import { describe, it, expect } from 'vitest';
import {
  parsePolicy,
  parsePolicySafe,
  validatePolicy,
  normalizeYaml,
  computePolicyHash,
  computeRepoKeyHash,
  computeMergeShaHash,
} from './index.js';

const SAMPLE_POLICY = `
version: 1

requiredChecks:
  - test
  - lint

payout:
  mode: tiered
  tiers:
    - name: docs
      amountUsd: 1
      match:
        onlyPaths:
          - "README.md"
          - "docs/**"
    - name: simple_fix
      amountUsd: 5
      match:
        maxFilesChanged: 5
        maxAdditions: 60
        maxDeletions: 60
    - name: security_patch
      amountUsd: 50
      match:
        anyPaths:
          - "src/auth/**"
          - "src/crypto/**"

holdIf:
  - rule: touchesPaths
    any:
      - ".github/workflows/**"
      - "package-lock.json"
  - rule: newDependencies
  - rule: coverageDrop
    gtPercent: 2

addressClaim:
  mode: pr_comment
  command: "/gitpay address"
`;

describe('Policy Parser', () => {
  describe('parsePolicy', () => {
    it('should parse valid policy', () => {
      const policy = parsePolicy(SAMPLE_POLICY);

      expect(policy.version).toBe(1);
      expect(policy.requiredChecks).toEqual(['test', 'lint']);
      expect(policy.payout.mode).toBe('tiered');
      expect(policy.payout.tiers).toHaveLength(3);
      expect(policy.holdIf).toHaveLength(3);
      expect(policy.addressClaim?.mode).toBe('pr_comment');
    });

    it('should throw on invalid policy', () => {
      expect(() => parsePolicy('invalid: yaml: structure:')).toThrow();
    });

    it('should throw on missing required fields', () => {
      const invalid = `
version: 1
# Missing payout field
`;
      expect(() => parsePolicy(invalid)).toThrow();
    });
  });

  describe('parsePolicySafe', () => {
    it('should return parsed policy for valid input', () => {
      const policy = parsePolicySafe(SAMPLE_POLICY);
      expect(policy).not.toBeNull();
      expect(policy?.version).toBe(1);
    });

    it('should return null for invalid input', () => {
      const policy = parsePolicySafe('invalid: yaml: structure:');
      expect(policy).toBeNull();
    });
  });

  describe('validatePolicy', () => {
    it('should return true for valid policy object', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      expect(validatePolicy(policy)).toBe(true);
    });

    it('should return false for invalid object', () => {
      expect(validatePolicy({ invalid: 'object' })).toBe(false);
    });
  });
});

describe('YAML Normalization', () => {
  it('should normalize YAML consistently', () => {
    const yaml1 = `
version: 1
payout:
  mode: fixed
  fixedAmountUsd: 10
`;
    const yaml2 = `
payout:
  fixedAmountUsd: 10
  mode: fixed
version: 1
`;

    const normalized1 = normalizeYaml(yaml1);
    const normalized2 = normalizeYaml(yaml2);

    expect(normalized1).toBe(normalized2);
  });

  it('should sort keys alphabetically', () => {
    const yaml = `
z: 1
a: 2
m: 3
`;
    const normalized = normalizeYaml(yaml);
    expect(normalized.indexOf('a:')).toBeLessThan(normalized.indexOf('m:'));
    expect(normalized.indexOf('m:')).toBeLessThan(normalized.indexOf('z:'));
  });
});

describe('Policy Hash', () => {
  it('should compute stable hash for identical content', () => {
    const hash1 = computePolicyHash(SAMPLE_POLICY);
    const hash2 = computePolicyHash(SAMPLE_POLICY);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should compute same hash regardless of key order', () => {
    const yaml1 = `
version: 1
payout:
  mode: fixed
  fixedAmountUsd: 10
`;
    const yaml2 = `
payout:
  fixedAmountUsd: 10
  mode: fixed
version: 1
`;

    const hash1 = computePolicyHash(yaml1);
    const hash2 = computePolicyHash(yaml2);

    expect(hash1).toBe(hash2);
  });

  it('should compute different hash for different content', () => {
    const yaml1 = `
version: 1
payout:
  mode: fixed
  fixedAmountUsd: 10
`;
    const yaml2 = `
version: 1
payout:
  mode: fixed
  fixedAmountUsd: 20
`;

    const hash1 = computePolicyHash(yaml1);
    const hash2 = computePolicyHash(yaml2);

    expect(hash1).not.toBe(hash2);
  });
});

describe('Repo Key Hash', () => {
  it('should compute stable hash for repo key', () => {
    const hash1 = computeRepoKeyHash('owner', 'repo');
    const hash2 = computeRepoKeyHash('owner', 'repo');

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should compute different hash for different repos', () => {
    const hash1 = computeRepoKeyHash('owner', 'repo1');
    const hash2 = computeRepoKeyHash('owner', 'repo2');

    expect(hash1).not.toBe(hash2);
  });
});

describe('Merge SHA Hash', () => {
  it('should compute stable hash for merge SHA', () => {
    const sha = 'abc123def456';
    const hash1 = computeMergeShaHash(sha);
    const hash2 = computeMergeShaHash(sha);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
  });
});
