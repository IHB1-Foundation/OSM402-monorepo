#!/usr/bin/env node

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { reviewPR } from '../packages/ai/dist/index.js';
import { parsePolicy, evaluateHoldWithRiskFlags } from '../packages/policy/dist/index.js';

function readEnvValue(name) {
  const envText = fs.readFileSync('.env', 'utf8');
  const match = envText.match(new RegExp(`^${name}=(.*)$`, 'm'));
  if (!match) return '';
  return match[1].replace(/^"|"$/g, '').trim();
}

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return (error && typeof error.stdout === 'string') ? error.stdout : '';
  }
}

function runWithCode(command) {
  try {
    const stdout = execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout };
  } catch (error) {
    return {
      code: Number(error?.status ?? 1),
      stdout: typeof error?.stdout === 'string' ? error.stdout : '',
      stderr: typeof error?.stderr === 'string' ? error.stderr : '',
    };
  }
}

function diffMeta(fromDir, toDir) {
  const filesChanged = run(`git diff --no-index --name-only -- ${fromDir} ${toDir}`)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((p) => p.replace(`${fromDir}/`, '').replace(`${toDir}/`, ''));

  const numstatLines = run(`git diff --no-index --numstat -- ${fromDir} ${toDir}`)
    .trim()
    .split('\n')
    .filter(Boolean);

  let additions = 0;
  let deletions = 0;
  for (const line of numstatLines) {
    const [a, d] = line.split('\t');
    additions += Number.isFinite(Number(a)) ? Number(a) : 0;
    deletions += Number.isFinite(Number(d)) ? Number(d) : 0;
  }

  const patch = run(`git diff --no-index -- ${fromDir} ${toDir}`);
  return { filesChanged, additions, deletions, patch };
}

function testRepo(repoDir) {
  const result = runWithCode(`cd ${repoDir} && npm test`);
  return {
    passed: result.code === 0,
    tail: (result.stdout || result.stderr || '').slice(-1200),
  };
}

function policyContextFromPolicy(policy) {
  const requiredChecks = policy.requiredChecks ?? [];
  const holdRules = [];
  const sensitivePathPatterns = [];

  for (const rule of policy.holdIf ?? []) {
    if (rule.rule === 'touchesPaths') {
      const any = rule.any ?? [];
      if (any.length > 0) {
        holdRules.push(`touchesPaths(${any.join(', ')})`);
        sensitivePathPatterns.push(...any);
      } else {
        holdRules.push('touchesPaths');
      }
      continue;
    }
    if (rule.rule === 'coverageDrop') {
      holdRules.push(`coverageDrop(gtPercent=${rule.gtPercent ?? 'n/a'})`);
      continue;
    }
    holdRules.push(rule.rule);
  }

  return {
    requiredChecks,
    holdRules,
    sensitivePathPatterns: Array.from(new Set(sensitivePathPatterns)),
  };
}

async function validateIssueWithGemini({ apiKey, model }) {
  const issueMarkdown = fs.readFileSync('demo/ISSUE_DEMO_001.md', 'utf8');
  const baseCalc = fs.readFileSync('demo/origin-repo/src/calc.js', 'utf8');
  const baseTest = fs.readFileSync('demo/origin-repo/test/calc.test.js', 'utf8');
  const prompt = [
    'You validate demo issue quality for a bounty flow.',
    'Return ONLY JSON with this schema:',
    '{"issueComplete":boolean,"summary":string[],"missingInfo":string[],"confidence":number}',
    '',
    '[ISSUE]',
    issueMarkdown,
    '',
    '[CODE]',
    baseCalc,
    '',
    '[TEST]',
    baseTest,
  ].join('\n');

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 1024 },
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, error: raw.slice(0, 500) };
  }

  try {
    const outer = JSON.parse(raw);
    const text = outer?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return { ok: true, status: res.status, output: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, error: raw.slice(0, 500) };
  }
}

async function reviewPrCase({ name, title, body, fromDir, toDir, policy, apiKey, model }) {
  const diff = diffMeta(fromDir, toDir);
  const tests = testRepo(toDir);

  const review = await reviewPR(
    {
      prTitle: title,
      prBody: body,
      diffSummary: {
        filesChanged: diff.filesChanged,
        additions: diff.additions,
        deletions: diff.deletions,
      },
      patches: diff.patch.slice(0, 4000),
      testResults: tests.tail,
      policyContext: {
        ...policyContextFromPolicy(policy),
      },
    },
    { apiKey, model, timeoutMs: 30000 }
  );

  const riskFlags = review?.riskFlags ?? [];
  const hold = evaluateHoldWithRiskFlags(policy, { filesChanged: diff.filesChanged }, riskFlags);

  return {
    name,
    diffSummary: {
      filesChanged: diff.filesChanged,
      additions: diff.additions,
      deletions: diff.deletions,
    },
    tests,
    review,
    hold,
    finalDecision:
      hold.shouldHold
        ? 'REJECT_HOLD'
        : tests.passed
          ? 'ACCEPT_READY'
          : 'REJECT_TEST_FAILURE',
  };
}

async function main() {
  const apiKey = readEnvValue('GEMINI_API_KEY');
  const model = readEnvValue('GEMINI_MODEL') || 'gemini-2.0-flash';
  if (!apiKey) {
    console.error('GEMINI_API_KEY missing in .env');
    process.exit(1);
  }

  const policy = parsePolicy(fs.readFileSync('demo/origin-repo/.osm402.yml', 'utf8'));
  const issue = await validateIssueWithGemini({ apiKey, model });

  const accept = await reviewPrCase({
    name: 'accept',
    title: 'Fix add() implementation (Closes #1)',
    body: 'Closes #1\n\nosm402:address 0xf44d918BBfF4bFeF4976c30371Cf0e938E39A876',
    fromDir: 'demo/origin-repo',
    toDir: 'demo/pr-accept-repo',
    policy,
    apiKey,
    model,
  });

  const reject = await reviewPrCase({
    name: 'reject',
    title: 'CI workflow tweak for maintenance (Closes #1)',
    body: 'Closes #1\n\nosm402:address 0xf44d918BBfF4bFeF4976c30371Cf0e938E39A876',
    fromDir: 'demo/origin-repo',
    toDir: 'demo/pr-reject-repo',
    policy,
    apiKey,
    model,
  });

  const now = new Date().toISOString();
  const result = {
    generatedAt: now,
    model,
    issue,
    prCases: { accept, reject },
    checks: {
      acceptConfirmed: accept.finalDecision === 'ACCEPT_READY',
      rejectConfirmed: reject.finalDecision === 'REJECT_HOLD',
    },
  };

  fs.mkdirSync('artifacts', { recursive: true });
  const stamped = `artifacts/gemini-demo-check-${now.replace(/[:]/g, '-')}.json`;
  const latest = 'artifacts/gemini-demo-check-latest.json';
  fs.writeFileSync(stamped, JSON.stringify(result, null, 2));
  fs.writeFileSync(latest, JSON.stringify(result, null, 2));

  console.log(`MODEL=${model}`);
  console.log(`OUTPUT=${stamped}`);
  console.log(`LATEST=${latest}`);
  console.log(`ACCEPT_DECISION=${accept.finalDecision}`);
  console.log(`REJECT_DECISION=${reject.finalDecision}`);
  console.log(`ACCEPT_CONFIRMED=${result.checks.acceptConfirmed}`);
  console.log(`REJECT_CONFIRMED=${result.checks.rejectConfirmed}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
