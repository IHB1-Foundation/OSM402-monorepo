import * as core from '@actions/core';
import * as github from '@actions/github';

async function run(): Promise<void> {
  try {
    const apiUrl = core.getInput('api_url', { required: true });
    const actionSecret = core.getInput('action_secret', { required: true });

    core.info(`GitPay Action starting...`);
    core.info(`API URL: ${apiUrl}`);
    core.info(`Repository: ${github.context.repo.owner}/${github.context.repo.repo}`);
    core.info(`Event: ${github.context.eventName}`);

    // Call health endpoint to verify connectivity
    const healthUrl = `${apiUrl}/api/health`;
    core.info(`Checking health endpoint: ${healthUrl}`);

    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-GitPay-Secret': actionSecret,
      },
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    core.info(`Health check successful: ${JSON.stringify(data)}`);
    core.setOutput('result', JSON.stringify(data));
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Action failed: ${error.message}`);
    } else {
      core.setFailed('Action failed with unknown error');
    }
  }
}

run();
