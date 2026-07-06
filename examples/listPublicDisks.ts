import { DefaultAzureCredential } from '@azure/identity';

import { SandboxGroupClient } from '../src/index.js';

// Usage:
// az login
// Create examples/.env with AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, and AZURE_SANDBOX_GROUP.
// pnpm dlx tsx examples/listPublicDisks.ts
declare const process: {
  env: Record<string, string | undefined>;
  loadEnvFile?: (path?: string | URL) => void;
};

loadExamplesEnv();

const credential = new DefaultAzureCredential();
const client = SandboxGroupClient.fromEnv({ credential, region: 'swedencentral' });

console.log(`Listing public disk images for sandbox group ${client.sandboxGroup}...`);

for await (const image of client.listPublicDiskImages()) {
  console.log(JSON.stringify(image, null, 2));
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
