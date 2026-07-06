import { DefaultAzureCredential } from '@azure/identity';

import { createAcaSandbox } from '../src/aiSdk/index.js';
import { SandboxGroupClient } from '../src/index.js';

// Usage:
// az login
// Create examples/.env with AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, and AZURE_SANDBOX_GROUP.
// pnpm dlx tsx examples/aiSdkSandbox.ts
//
// In an installed package, import the provider with:
// import { createAcaSandbox } from 'aca-sandboxes-sdk/ai-sdk';
declare const process: {
  env: Record<string, string | undefined>;
  loadEnvFile?: (path?: string | URL) => void;
};

loadExamplesEnv();

const credential = new DefaultAzureCredential();
const client = SandboxGroupClient.fromEnv({ credential, region: 'swedencentral' });
const provider = createAcaSandbox({
  client,
  labels: { example: 'ai-sdk-sandbox' },
});

const networkSandboxSession = await provider.createSession({ sessionId: 'ai-sdk-example' });
const sandboxSession = networkSandboxSession.restricted();

try {
  console.log(`Created ACA sandbox ${networkSandboxSession.id}`);
  console.log(sandboxSession.description);

  await sandboxSession.writeTextFile({
    path: 'hello-ai-sdk.txt',
    content: 'Hello from an ACA sandbox through the AI SDK sandbox interface.\n',
  });

  const fileContents = await sandboxSession.readTextFile({ path: 'hello-ai-sdk.txt' });
  console.log(`Read file: ${fileContents?.trim()}`);

  const result = await sandboxSession.run({
    command: 'pwd && ls -la hello-ai-sdk.txt && cat hello-ai-sdk.txt',
  });
  console.log(`Command exit code: ${result.exitCode}`);
  console.log(result.stdout);

  const resumed = await provider.resumeSession?.({ sessionId: 'ai-sdk-example' });
  console.log(`Resumed ACA sandbox ${resumed?.id}`);
} finally {
  await networkSandboxSession.destroy?.();
}

function loadExamplesEnv(): void {
  try {
    process.loadEnvFile?.(new URL('.env', import.meta.url));
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

function isMissingFileError(error: unknown): error is { code: 'ENOENT' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
