import * as core from '@actions/core';
import * as github from '@actions/github';

/**
 * Parse bounty label: "bounty:$10" → 10
 */
function parseBountyLabel(label: string): number | null {
  const match = label.match(/^bounty:\$(\d+(?:\.\d+)?)$/);
  return match ? parseFloat(match[1]!) : null;
}

/**
 * Build base64-encoded x402 payment header for mock mode.
 * In production, this would sign a real transaction.
 */
function buildPaymentHeader(
  amount: string,
  asset: string,
  chainId: number,
  payer: string,
): string {
  const payload = {
    paymentHash: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    amount,
    asset,
    chainId,
    payer,
    txHash: `0x${Buffer.from(Date.now().toString()).toString('hex').padStart(64, '0')}`,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

interface PaymentRequirement {
  amount: string;
  asset: string;
  chainId: number;
  recipient: string;
  description: string;
}

interface X402Response {
  status: number;
  message: string;
  x402: {
    version: string;
    requirement: PaymentRequirement;
    instructions: { type: string; header: string; format: string };
  };
}

async function run(): Promise<void> {
  try {
    const apiUrl = core.getInput('api_url', { required: true });
    const actionSecret = core.getInput('action_secret', { required: true });
    const payerAddress = core.getInput('payer_address') || '0x0000000000000000000000000000000000000001';

    const { owner, repo } = github.context.repo;
    const repoKey = `${owner}/${repo}`;

    core.info(`OSM402 Action starting...`);
    core.info(`API URL: ${apiUrl}`);
    core.info(`Repository: ${repoKey}`);
    core.info(`Event: ${github.context.eventName}`);

    // Step 1: Health check
    core.info('--- Step 1: Health check ---');
    const healthRes = await fetch(`${apiUrl}/api/health`, {
      headers: { 'X-OSM402-Secret': actionSecret },
    });
    if (!healthRes.ok) {
      throw new Error(`Health check failed: ${healthRes.status}`);
    }
    core.info(`Health OK: ${JSON.stringify(await healthRes.json())}`);

    // Step 2: Determine bounty from event context
    core.info('--- Step 2: Parse bounty label ---');
    let issueNumber: number | undefined;
    let bountyCapUsd: number | undefined;

    if (github.context.eventName === 'issues' && github.context.payload.action === 'labeled') {
      const label = github.context.payload.label?.name as string | undefined;
      issueNumber = github.context.payload.issue?.number;
      if (label) {
        bountyCapUsd = parseBountyLabel(label) ?? undefined;
      }
      core.info(`Issue #${issueNumber}, label: "${label}", bounty: $${bountyCapUsd ?? 'N/A'}`);
    } else if (github.context.eventName === 'workflow_dispatch') {
      // Manual trigger: use inputs
      issueNumber = parseInt(core.getInput('issue_number') || '0', 10) || undefined;
      bountyCapUsd = parseFloat(core.getInput('bounty_amount') || '0') || undefined;
      core.info(`Manual dispatch: issue #${issueNumber}, bounty $${bountyCapUsd ?? 'N/A'}`);
    }

    if (!issueNumber || !bountyCapUsd) {
      core.info('No bounty label detected or not an issues.labeled event. Exiting.');
      core.setOutput('result', JSON.stringify({ skipped: true, reason: 'no bounty label' }));
      return;
    }

    // Step 3: Call /api/fund (expect 402)
    core.info('--- Step 3: Call /api/fund (expect 402) ---');
    const fundBody = { repoKey, issueNumber, bountyCapUsd };
    core.info(`Fund request: ${JSON.stringify(fundBody)}`);

    const fundRes = await fetch(`${apiUrl}/api/fund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OSM402-Secret': actionSecret,
      },
      body: JSON.stringify(fundBody),
    });

    if (fundRes.status !== 402) {
      // Might already be funded (200) or an error
      const data = await fundRes.json();
      if (fundRes.ok) {
        core.info(`Already funded: ${JSON.stringify(data)}`);
        core.setOutput('result', JSON.stringify(data));
        return;
      }
      throw new Error(`Unexpected response ${fundRes.status}: ${JSON.stringify(data)}`);
    }

    // Step 4: Parse 402 payment requirements
    core.info('--- Step 4: Received 402 — parsing payment requirements ---');
    const paymentRequired = (await fundRes.json()) as X402Response;
    const requirement = paymentRequired.x402.requirement;
    core.info(`Payment required: amount=${requirement.amount}, asset=${requirement.asset}, chainId=${requirement.chainId}`);
    core.info(`Recipient: ${requirement.recipient}`);

    // Step 5: Build payment header and retry
    core.info('--- Step 5: Building x402 payment and retrying ---');
    const paymentHeader = buildPaymentHeader(
      requirement.amount,
      requirement.asset,
      requirement.chainId,
      payerAddress,
    );
    core.info(`Payment header built (base64, ${paymentHeader.length} chars)`);

    const paidRes = await fetch(`${apiUrl}/api/fund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OSM402-Secret': actionSecret,
        'X-Payment': paymentHeader,
      },
      body: JSON.stringify(fundBody),
    });

    if (paidRes.status === 402) {
      const stillRequired = (await paidRes.json()) as X402Response & Record<string, unknown>;
      core.warning('Server still requires a valid x402 payment proof. This action only supports mock-mode headers.');
      core.info(`Requirement: ${JSON.stringify(stillRequired.x402?.requirement ?? {}, null, 2)}`);
      core.setOutput(
        'result',
        JSON.stringify({
          skipped: true,
          reason: 'real_x402_required',
          requirement: stillRequired.x402?.requirement,
          serverResponse: stillRequired,
        })
      );
      return;
    }

    const paidData = (await paidRes.json()) as Record<string, unknown>;

    if (!paidRes.ok) {
      throw new Error(`Funded request failed (${paidRes.status}): ${JSON.stringify(paidData)}`);
    }

    // Step 6: Success
    core.info('--- Step 6: Funding successful ---');
    core.info(`Result: ${JSON.stringify(paidData, null, 2)}`);
    core.setOutput('result', JSON.stringify(paidData));

    const escrow = paidData.escrow as Record<string, string> | undefined;
    const issue = paidData.issue as Record<string, string> | undefined;
    core.setOutput('escrow_address', escrow?.address ?? '');
    core.setOutput('deposit_tx', escrow?.depositTxHash ?? '');
    core.setOutput('intent_hash', issue?.intentHash ?? '');
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Action failed: ${error.message}`);
    } else {
      core.setFailed('Action failed with unknown error');
    }
  }
}

run();
