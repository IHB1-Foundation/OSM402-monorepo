import { keccak256, toHex } from 'viem';
import type { Hex } from 'viem';
import { normalizeYaml } from './parser.js';

/**
 * Compute keccak256 hash of policy content
 * @param content Raw YAML content
 * @returns keccak256 hash as hex string
 */
export function computePolicyHash(content: string): Hex {
  // Normalize YAML for consistent hashing
  const normalized = normalizeYaml(content);

  // Convert to bytes and hash
  const bytes = new TextEncoder().encode(normalized);
  return keccak256(toHex(bytes));
}

/**
 * Compute keccak256 hash of a repo key (owner/repo)
 * @param owner Repository owner
 * @param repo Repository name
 * @returns keccak256 hash as hex string
 */
export function computeRepoKeyHash(owner: string, repo: string): Hex {
  const repoKey = `${owner}/${repo}`;
  return keccak256(toHex(repoKey));
}

/**
 * Compute keccak256 hash of a merge SHA
 * @param sha Git commit SHA
 * @returns keccak256 hash as hex string
 */
export function computeMergeShaHash(sha: string): Hex {
  return keccak256(toHex(sha));
}
