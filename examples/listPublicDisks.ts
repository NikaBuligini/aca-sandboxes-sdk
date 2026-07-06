import { DefaultAzureCredential } from '@azure/identity';

import { SandboxGroupClient, endpointForRegion } from '../src/index.js';

// Usage:
// az login
// AZURE_SUBSCRIPTION_ID=... AZURE_RESOURCE_GROUP=... AZURE_SANDBOX_GROUP=... pnpm dlx tsx examples/listPublicDisks.ts
declare const process: { env: Record<string, string | undefined> };

const subscriptionId = requiredEnv('AZURE_SUBSCRIPTION_ID');
const resourceGroup = requiredEnv('AZURE_RESOURCE_GROUP');
const sandboxGroup = requiredEnv('AZURE_SANDBOX_GROUP');
const region = process.env.AZURE_REGION ?? 'eastus2';

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
