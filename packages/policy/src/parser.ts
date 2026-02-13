import YAML from 'yaml';
import { PolicySchema, type Policy } from './types.js';

/**
 * Parse a .osm402.yml file content into a Policy object
 * @param content Raw YAML content
 * @returns Parsed and validated Policy
 * @throws Error if parsing or validation fails
 */
export function parsePolicy(content: string): Policy {
  const parsed = YAML.parse(content);
  return PolicySchema.parse(parsed);
}

/**
 * Safely parse a .osm402.yml file content
 * @param content Raw YAML content
 * @returns Parsed Policy or null if invalid
 */
export function parsePolicySafe(content: string): Policy | null {
  try {
    const parsed = YAML.parse(content);
    const result = PolicySchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Validate a policy object
 * @param policy Policy object to validate
 * @returns true if valid
 */
export function validatePolicy(policy: unknown): policy is Policy {
  return PolicySchema.safeParse(policy).success;
}

/**
 * Normalize YAML content for consistent hashing
 * - Parse YAML
 * - Re-serialize with consistent formatting
 * - Sort keys alphabetically
 * @param content Raw YAML content
 * @returns Normalized YAML string
 */
export function normalizeYaml(content: string): string {
  const parsed = YAML.parse(content);
  return YAML.stringify(parsed, {
    sortMapEntries: true,
    lineWidth: 0, // No line wrapping
  });
}
