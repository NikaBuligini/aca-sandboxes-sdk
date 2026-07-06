import { DefaultAzureCredential } from '@azure/identity';

import { SandboxGroupClient, endpointForRegion } from '../src/index.js';

// Usage:
// az login
// Create examples/.env with AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, and AZURE_SANDBOX_GROUP.
// pnpm dlx tsx examples/listPublicDisks.ts
declare const process: {
  env: Record<string, string | undefined>;
  loadEnvFile?: (path?: string | URL) => void;
};

loadExamplesEnv();

const subscriptionId = requiredEnv('AZURE_SUBSCRIPTION_ID');
const resourceGroup = requiredEnv('AZURE_RESOURCE_GROUP');
const sandboxGroup = requiredEnv('AZURE_SANDBOX_GROUP');
const region = process.env.AZURE_REGION ?? 'swedencentral';

const credential = new DefaultAzureCredential();

const client = new SandboxGroupClient(endpointForRegion(region), credential, {
  subscriptionId,
  resourceGroup,
  sandboxGroup,
});

console.log(`Listing public disk images in ${region} for sandbox group ${sandboxGroup}...`);

for await (const image of client.listPublicDiskImages()) {
  console.log(JSON.stringify(image, null, 2));
}

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
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
