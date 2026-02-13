import { describe, it, expect } from 'vitest';
import {
  parsePolicy,
  parsePolicySafe,
  validatePolicy,
  normalizeYaml,
  computePolicyHash,
  computeRepoKeyHash,
  computeMergeShaHash,
  calculatePayout,
  getMaxPayout,
  evaluateHold,
  evaluateRiskFlags,
  evaluateHoldWithRiskFlags,
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
  command: "/osm402 address"
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

describe('Payout Calculator', () => {
  describe('Fixed mode', () => {
    it('should return fixed amount', () => {
      const policy = parsePolicy(`
version: 1
payout:
  mode: fixed
  fixedAmountUsd: 25
`);
      const result = calculatePayout(policy, {
        filesChanged: ['src/app.ts'],
        additions: 100,
        deletions: 50,
      });

      expect(result.amountUsd).toBe(25);
      expect(result.tier).toBeNull();
    });
  });

  describe('Tiered mode', () => {
    it('should match docs tier with onlyPaths', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = calculatePayout(policy, {
        filesChanged: ['README.md', 'docs/guide.md'],
        additions: 10,
        deletions: 5,
      });

      expect(result.amountUsd).toBe(1);
      expect(result.tier).toBe('docs');
    });

    it('should match simple_fix tier with size constraints', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = calculatePayout(policy, {
        filesChanged: ['src/app.ts', 'src/utils.ts'],
        additions: 30,
        deletions: 20,
      });

      expect(result.amountUsd).toBe(5);
      expect(result.tier).toBe('simple_fix');
    });

    it('should match security_patch tier with anyPaths', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = calculatePayout(policy, {
        filesChanged: ['src/auth/login.ts', 'src/app.ts'],
        additions: 100,
        deletions: 50,
      });

      expect(result.amountUsd).toBe(50);
      expect(result.tier).toBe('security_patch');
    });

    it('should return 0 when no tier matches', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = calculatePayout(policy, {
        filesChanged: ['src/app.ts'],
        additions: 100, // Exceeds simple_fix maxAdditions
        deletions: 50,
      });

      expect(result.amountUsd).toBe(0);
      expect(result.tier).toBeNull();
    });

    it('should match first tier in order (deterministic)', () => {
      // Tiers are evaluated in order, first match wins
      const policy = parsePolicy(SAMPLE_POLICY);

      // This matches docs (onlyPaths) AND could potentially match others
      // but docs comes first
      const result = calculatePayout(policy, {
        filesChanged: ['docs/README.md'],
        additions: 5,
        deletions: 2,
      });

      expect(result.tier).toBe('docs');
    });
  });

  describe('Determinism', () => {
    it('should return same result for same input', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const diff = {
        filesChanged: ['src/app.ts'],
        additions: 30,
        deletions: 10,
      };

      const result1 = calculatePayout(policy, diff);
      const result2 = calculatePayout(policy, diff);

      expect(result1).toEqual(result2);
    });
  });

  describe('getMaxPayout', () => {
    it('should return max tier amount', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      expect(getMaxPayout(policy)).toBe(50);
    });

    it('should return fixed amount for fixed mode', () => {
      const policy = parsePolicy(`
version: 1
payout:
  mode: fixed
  fixedAmountUsd: 100
`);
      expect(getMaxPayout(policy)).toBe(100);
    });
  });
});

describe('HOLD Rule Evaluator', () => {
  describe('touchesPaths', () => {
    it('should trigger HOLD when touching sensitive paths', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = evaluateHold(policy, {
        filesChanged: ['.github/workflows/ci.yml', 'src/app.ts'],
      });

      expect(result.shouldHold).toBe(true);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toContain('.github/workflows/ci.yml');
    });

    it('should not trigger when paths are safe', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = evaluateHold(policy, {
        filesChanged: ['src/app.ts', 'src/utils.ts'],
      });

      expect(result.shouldHold).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });

    it('should trigger for package-lock.json', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = evaluateHold(policy, {
        filesChanged: ['package-lock.json'],
      });

      expect(result.shouldHold).toBe(true);
      expect(result.reasons[0]).toContain('package-lock.json');
    });
  });

  describe('newDependencies', () => {
    it('should trigger HOLD when new dependencies added', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = evaluateHold(policy, {
        filesChanged: ['package.json'],
        newDependencies: ['lodash', 'axios'],
      });

      expect(result.shouldHold).toBe(true);
      expect(result.reasons.some((r) => r.includes('lodash'))).toBe(true);
    });

    it('should not trigger when no new dependencies', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = evaluateHold(policy, {
        filesChanged: ['package.json'],
        newDependencies: [],
      });

      expect(result.shouldHold).toBe(false);
    });
  });

  describe('coverageDrop', () => {
    it('should trigger HOLD when coverage drops beyond threshold', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = evaluateHold(policy, {
        filesChanged: ['src/app.ts'],
        coverageChange: -5, // 5% drop
      });

      expect(result.shouldHold).toBe(true);
      expect(result.reasons.some((r) => r.includes('Coverage'))).toBe(true);
    });

    it('should not trigger when coverage drop is within threshold', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = evaluateHold(policy, {
        filesChanged: ['src/app.ts'],
        coverageChange: -1, // 1% drop, threshold is 2%
      });

      expect(result.shouldHold).toBe(false);
    });

    it('should not trigger when coverage increases', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = evaluateHold(policy, {
        filesChanged: ['src/app.ts'],
        coverageChange: 5, // 5% increase
      });

      expect(result.shouldHold).toBe(false);
    });
  });

  describe('evaluateRiskFlags', () => {
    it('should return risk flag reasons', () => {
      const reasons = evaluateRiskFlags(['auth-change', 'new-dependency']);

      expect(reasons).toHaveLength(2);
      expect(reasons[0]).toContain('auth-change');
      expect(reasons[1]).toContain('new-dependency');
    });

    it('should return empty for no risk flags', () => {
      const reasons = evaluateRiskFlags([]);
      expect(reasons).toHaveLength(0);
    });
  });

  describe('evaluateHoldWithRiskFlags', () => {
    it('should combine policy and risk flag reasons', () => {
      const policy = parsePolicy(SAMPLE_POLICY);
      const result = evaluateHoldWithRiskFlags(
        policy,
        {
          filesChanged: ['.github/workflows/ci.yml'],
        },
        ['security-concern']
      );

      expect(result.shouldHold).toBe(true);
      expect(result.reasons.length).toBeGreaterThan(1);
    });
  });

  describe('No holdIf rules', () => {
    it('should not trigger HOLD when no rules defined', () => {
      const policy = parsePolicy(`
version: 1
payout:
  mode: fixed
  fixedAmountUsd: 10
`);
      const result = evaluateHold(policy, {
        filesChanged: ['.github/workflows/ci.yml'],
        newDependencies: ['malicious-package'],
        coverageChange: -50,
      });

      expect(result.shouldHold).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });
  });
});
