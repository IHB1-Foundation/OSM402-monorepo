import { z } from 'zod';

/**
 * Path match configuration
 */
export const PathMatchSchema = z.object({
  onlyPaths: z.array(z.string()).optional(),
  anyPaths: z.array(z.string()).optional(),
  maxFilesChanged: z.number().optional(),
  maxAdditions: z.number().optional(),
  maxDeletions: z.number().optional(),
});

/**
 * Payout tier configuration
 */
export const TierSchema = z.object({
  name: z.string(),
  amountUsd: z.number(),
  match: PathMatchSchema.optional(),
});

/**
 * Payout configuration
 */
export const PayoutSchema = z.object({
  mode: z.enum(['fixed', 'tiered']),
  fixedAmountUsd: z.number().optional(),
  tiers: z.array(TierSchema).optional(),
});

/**
 * Hold rule configuration
 */
export const HoldRuleSchema = z.object({
  rule: z.enum(['touchesPaths', 'newDependencies', 'coverageDrop']),
  any: z.array(z.string()).optional(),
  gtPercent: z.number().optional(),
});

/**
 * Address claim configuration
 */
export const AddressClaimSchema = z.object({
  mode: z.enum(['pr_comment']),
  command: z.string(),
});

/**
 * Complete .gitpay.yml policy schema
 */
export const PolicySchema = z.object({
  version: z.number(),
  requiredChecks: z.array(z.string()).optional(),
  payout: PayoutSchema,
  holdIf: z.array(HoldRuleSchema).optional(),
  addressClaim: AddressClaimSchema.optional(),
});

/**
 * Policy type inferred from schema
 */
export type Policy = z.infer<typeof PolicySchema>;
export type PathMatch = z.infer<typeof PathMatchSchema>;
export type Tier = z.infer<typeof TierSchema>;
export type Payout = z.infer<typeof PayoutSchema>;
export type HoldRule = z.infer<typeof HoldRuleSchema>;
export type AddressClaim = z.infer<typeof AddressClaimSchema>;
