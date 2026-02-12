/**
 * Handler for contributor payout address claims.
 * Supports:
 *   - PR/issue comment: `/gitpay address 0x...`
 *   - PR body token: `gitpay:address 0x...`
 */

import { getPr, updatePr, getAllPrs } from '../store/prs.js';
import { postIssueComment } from '../services/github.js';

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Extract payout address from text.
 * Matches:  /gitpay address 0x...  OR  gitpay:address 0x...
 */
export function extractAddress(text: string): string | null {
  const match = text.match(/(?:\/gitpay\s+address|gitpay:address)\s+(0x[0-9a-fA-F]{40})\b/);
  return match ? match[1]! : null;
}

/**
 * Validate an EVM address (checksum not enforced, just format).
 */
export function isValidEvmAddress(addr: string): boolean {
  return EVM_ADDRESS_RE.test(addr);
}

interface IssueCommentPayload {
  action: 'created' | 'edited' | 'deleted';
  issue: {
    number: number;
    pull_request?: { url: string }; // Present if the "issue" is actually a PR
  };
  comment: {
    id: number;
    body: string;
    user: { login: string };
  };
  repository: {
    full_name: string;
  };
}

/**
 * Handle issue_comment.created to capture `/gitpay address 0x...` commands.
 */
export async function handleAddressClaim(payload: IssueCommentPayload): Promise<{
  handled: boolean;
  address?: string;
  prNumber?: number;
}> {
  // Only process 'created' actions
  if (payload.action !== 'created') {
    return { handled: false };
  }

  const body = payload.comment.body;
  const address = extractAddress(body);
  if (!address) {
    return { handled: false };
  }

  if (!isValidEvmAddress(address)) {
    return { handled: false };
  }

  const repoKey = payload.repository.full_name;
  const issueOrPrNumber = payload.issue.number;
  const isPr = !!payload.issue.pull_request;
  const commenter = payload.comment.user.login;

  if (isPr) {
    // Comment is on a PR - update that PR directly
    const prRecord = getPr(repoKey, issueOrPrNumber);
    if (prRecord && prRecord.contributorGithub === commenter) {
      updatePr(repoKey, issueOrPrNumber, { contributorAddress: address });
      console.log(`[address] Stored ${address} for PR ${repoKey}#PR${issueOrPrNumber} (from PR comment)`);

      await postIssueComment(repoKey, issueOrPrNumber,
        `**GitPay** Payout address registered: \`${address}\``
      );
      return { handled: true, address, prNumber: issueOrPrNumber };
    }

    // If commenter is not the PR author, still record it but warn
    if (prRecord) {
      updatePr(repoKey, issueOrPrNumber, { contributorAddress: address });
      console.log(`[address] Stored ${address} for PR ${repoKey}#PR${issueOrPrNumber} (from ${commenter}, PR author: ${prRecord.contributorGithub})`);
      await postIssueComment(repoKey, issueOrPrNumber,
        `**GitPay** Payout address registered: \`${address}\` (claimed by @${commenter})`
      );
      return { handled: true, address, prNumber: issueOrPrNumber };
    }
  } else {
    // Comment is on an issue - find PRs linked to this issue
    const linkedPrs = getAllPrs().filter(
      pr => pr.repoKey === repoKey && pr.issueNumber === issueOrPrNumber
    );

    for (const pr of linkedPrs) {
      updatePr(repoKey, pr.prNumber, { contributorAddress: address });
      console.log(`[address] Stored ${address} for PR ${repoKey}#PR${pr.prNumber} (from issue #${issueOrPrNumber} comment)`);
    }

    if (linkedPrs.length > 0) {
      await postIssueComment(repoKey, issueOrPrNumber,
        `**GitPay** Payout address registered: \`${address}\` (linked to ${linkedPrs.length} PR(s))`
      );
      return { handled: true, address };
    }
  }

  return { handled: false };
}

/**
 * Extract address from PR body during PR open/synchronize.
 * Called from prEvent handler.
 */
export function extractAddressFromPrBody(body: string | null): string | null {
  if (!body) return null;
  const addr = extractAddress(body);
  return addr && isValidEvmAddress(addr) ? addr : null;
}
