# aca-sandboxes-sdk

Unofficial TypeScript SDK for Azure Container Apps sandboxes.

This is a [slopfork](https://www.slopfork.dev/) of the official Python SDK. This package mirrors the public preview Python SDK shape where practical, but it is not an official Microsoft package. The ACA sandboxes API is preview and may change without notice.

Initial API compatibility was based on Python package `azure-containerapps-sandbox@0.1.0b3`. The tracked upstream Python SDK version is stored in `upstream/pythonSdk.json`.

## Install

```bash
pnpm add aca-sandboxes-sdk @azure/identity
```

## Quick Start

```ts
import { DefaultAzureCredential } from "@azure/identity";
import { SandboxGroupClient } from "aca-sandboxes-sdk";

const client = new SandboxGroupClient({
  credential: new DefaultAzureCredential(),
  region: "eastus2",
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID!,
  resourceGroup: process.env.AZURE_RESOURCE_GROUP!,
  sandboxGroup: process.env.AZURE_SANDBOX_GROUP!,
});

const sandbox = await client.createSandbox({ disk: "ubuntu" });

const result = await sandbox.exec("echo 'Hello from ACA Sandbox.'", { check: true });
console.log(result.stdout);

await sandbox.delete();
```

## Environment Factory

```ts
const client = SandboxGroupClient.fromEnv({
  credential: new DefaultAzureCredential(),
  region: "eastus2",
});
```

`fromEnv()` reads `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_SANDBOX_GROUP`, and optionally `AZURE_REGION`. Explicit values override environment variables.

## Create a Sandbox Group

```ts
import { DefaultAzureCredential } from "@azure/identity";
import { SandboxGroupManagementClient } from "aca-sandboxes-sdk";

const management = SandboxGroupManagementClient.fromEnv({
  credential: new DefaultAzureCredential(),
});

await management.createGroup(process.env.AZURE_SANDBOX_GROUP!, "eastus2");
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

const publicImages = await client.listPublicDiskImages().toArray();
```

## Advanced Pollers

Long-running operations return awaitable `OperationPoller` objects. Await them directly for the common case, or keep the poller to inspect progress and customize polling.

```ts
const poller = client.createSandbox({ disk: "ubuntu" });

console.log(poller.status);
await poller.poll();

const sandbox = await poller.pollUntilDone({ intervalInMs: 5_000, timeoutInMs: 600_000 });
```

The operation request starts as soon as the method is called.

## Effect Integration

The main SDK API is Promise-based. A richer Effect API is available from `aca-sandboxes-sdk/effect`.

```ts
import { Effect } from "effect";
import { exec, withSandbox } from "aca-sandboxes-sdk/effect";

const program = withSandbox(client, { disk: "ubuntu" }, (sandbox) =>
  exec(sandbox, "echo hello", { check: true }),
);

const result = await Effect.runPromise(program);
console.log(result.stdout);
```

`withSandbox` creates a sandbox, runs the scoped Effect, and deletes the sandbox when the scope exits.

The Effect entrypoint also exposes scoped resources, streams, and services:

```ts
import { DefaultAzureCredential } from "@azure/identity";
import { Effect, Layer, Stream } from "effect";
import {
  AcaSandboxes,
  AzureCredential,
  exec,
} from "aca-sandboxes-sdk/effect";

const program = Effect.gen(function* () {
  const service = yield* AcaSandboxes;

  const sandboxes = yield* service.listSandboxes().pipe(Stream.runCollect);
  console.log(Array.from(sandboxes).map((sandbox) => sandbox.id));

  const sandbox = yield* service.acquireSandbox({ disk: "ubuntu" });
  const result = yield* exec(sandbox, "echo scoped", { check: true });
  console.log(result.stdout);
}).pipe(Effect.scoped);

await Effect.runPromise(
  program.pipe(
    Effect.provide(AcaSandboxes.layerConfig()),
    Effect.provide(Layer.succeed(AzureCredential, new DefaultAzureCredential())),
  ),
);
```

SDK errors are tagged errors, so Effect users can recover with `Effect.catchTag` / `Effect.catchTags` using tags such as `AcaSandboxError`, `CommandFailedError`, `CredentialError`, `NetworkError`, `PollTimeoutError`, and `OperationFailedError`.

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
