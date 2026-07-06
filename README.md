# aca-sandboxes-sdk

Unofficial TypeScript SDK for Azure Container Apps sandboxes.

This is a [slopfork](https://www.slopfork.dev/) of the official Python SDK. Whoever uses this library should take that into account.

This package mirrors the public preview Python SDK shape where practical, but it is not an official Microsoft package. The ACA sandboxes API is preview and may change without notice.

Initial API compatibility was based on Python package `azure-containerapps-sandbox@0.1.0b3`. The tracked upstream Python SDK version is stored in `upstream/pythonSdk.json`.

## Install

```bash
pnpm add aca-sandboxes-sdk @azure/identity
```

## Quick Start

```ts
import { DefaultAzureCredential } from "@azure/identity";
import { SandboxGroupClient, endpointForRegion } from "aca-sandboxes-sdk";

const credential = new DefaultAzureCredential();

const client = new SandboxGroupClient(endpointForRegion("eastus2"), credential, {
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID!,
  resourceGroup: process.env.AZURE_RESOURCE_GROUP!,
  sandboxGroup: process.env.AZURE_SANDBOX_GROUP!,
});

const sandbox = await client
  .beginCreateSandbox({ disk: "ubuntu" })
  .pollUntilDone();

const result = await sandbox.exec("echo 'Hello from ACA Sandbox.'");
console.log(result.stdout);

await sandbox.delete();
```

## Create a Sandbox Group

```ts
import { DefaultAzureCredential } from "@azure/identity";
import { SandboxGroupManagementClient } from "aca-sandboxes-sdk";

const management = new SandboxGroupManagementClient(new DefaultAzureCredential(), {
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID!,
  resourceGroup: process.env.AZURE_RESOURCE_GROUP!,
});

await management
  .beginCreateGroup(process.env.AZURE_SANDBOX_GROUP!, "eastus2")
  .pollUntilDone();
```

You still need a resource group and the proper `Container Apps SandboxGroup Data Owner` role assignment for data-plane calls.

## Files

```ts
await sandbox.writeFile("/tmp/hello.txt", "Hello from TypeScript");
const content = await sandbox.readTextFile("/tmp/hello.txt");
console.log(content);

const listing = await sandbox.listFiles("/tmp");
console.log(listing.entries);
```

## Lifecycle

```ts
await sandbox.stop();
await sandbox.resume();
await sandbox.waitForRunning();
```

## Listing

```ts
for await (const sandbox of client.listSandboxes({ labels: { tier: "dev" } })) {
  console.log(sandbox.id, sandbox.state);
}
```

## Effect Integration

The main SDK API is Promise-based. An optional Effect adapter is available from `aca-sandboxes-sdk/effect`.

Install `effect` only if you use this entrypoint:

```bash
pnpm add effect
```

```ts
import { Effect } from "effect";
import { exec, withSandbox } from "aca-sandboxes-sdk/effect";

const program = withSandbox(client, { disk: "ubuntu" }, (sandbox) =>
  exec(sandbox, "echo hello"),
);

const result = await Effect.runPromise(program);
console.log(result.stdout);
```

`withSandbox` creates a sandbox, runs the scoped Effect, and deletes the sandbox when the scope exits.

## API Coverage

Implemented:

- `SandboxGroupClient` for data-plane sandbox groups
- `SandboxClient` for sandbox-scoped operations
- `SandboxGroupManagementClient` for ARM sandbox groups
- sandbox create/list/get/delete
- exec
- file operations
- lifecycle stop/resume/wait
- ports
- snapshots
- disk images
- volumes
- secrets
- basic egress policy helpers

Not implemented yet:

- interactive PTY shell, matching the Python SDK limitation
- exhaustive client-side validation for every preview model
- generated OpenAPI-level model coverage
