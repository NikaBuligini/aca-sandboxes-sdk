# aca-sandboxes-sdk

Unofficial TypeScript SDK for Azure Container Apps sandboxes.

This is a [slopfork](https://www.slopfork.dev/) of the official Python SDK. This package mirrors the public preview Python SDK shape where practical, but it is not an official Microsoft package. The ACA sandboxes API is preview and may change without notice.

Initial API compatibility was based on Python package `azure-containerapps-sandbox@0.1.0b3`. The tracked upstream Python SDK version is stored in `upstream/pythonSdk.json`.

## Install

```bash
pnpm add aca-sandboxes-sdk @azure/identity
```

For the AI SDK sandbox provider, also install the optional AI SDK peer dependencies:

```bash
pnpm add aca-sandboxes-sdk @azure/identity @ai-sdk/harness @ai-sdk/provider-utils
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

## AI SDK Sandbox Provider

The `aca-sandboxes-sdk/ai-sdk` entrypoint exposes an AI SDK Harness sandbox provider backed by ACA sandboxes.

```ts
import { DefaultAzureCredential } from "@azure/identity";
import { SandboxGroupClient } from "aca-sandboxes-sdk";
import { createAcaSandbox } from "aca-sandboxes-sdk/ai-sdk";

const client = SandboxGroupClient.fromEnv({
  credential: new DefaultAzureCredential(),
  region: "eastus2",
});

const provider = createAcaSandbox({
  client,
  disk: "ubuntu",
  labels: { app: "ai-sdk" },
});

const networkSession = await provider.createSession({
  sessionId: "example-session",
});
const session = networkSession.restricted();

await session.writeTextFile({
  path: "hello.txt",
  content: "Hello from ACA through the AI SDK sandbox API.\n",
});

const result = await session.run({ command: "cat hello.txt" });
console.log(result.stdout);

await networkSession.destroy?.();
```

`createSession()` creates an ACA sandbox and, when a `sessionId` is provided, labels it so `resumeSession()` can find the same sandbox later and ensure it is running.

Sessions created from a `SandboxGroupClient` own their lifecycle: `stop()` stops the sandbox and `destroy()` deletes it. Providers created with an existing `SandboxClient` wrap that sandbox and do not stop or delete it.

Ports can be exposed at create time or replaced later. Numeric ports default to anonymous auth (`{ auth: { anonymous: true } }`) so AI SDK bridge WebSockets can connect.

```ts
const provider = createAcaSandbox({
  client,
  disk: "ubuntu",
  ports: [3000],
});

const session = await provider.createSession();
const url = await session.getPortUrl({ port: 3000, protocol: "https" });
console.log(url);
```

Network policy mapping supports `allow-all`, `deny-all`, and custom host allow-lists. CIDR allow/deny rules are not currently mapped to ACA egress policies.

```ts
await session.setNetworkPolicy?.({
  mode: "custom",
  allowedHosts: ["api.example.com", "*.example.org"],
});
```

See `examples/aiSdkSandbox.ts` for a runnable example.

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
- AI SDK Harness provider via `aca-sandboxes-sdk/ai-sdk`
- AI SDK sandbox sessions with `run`, emulated `spawn`, file reads/writes, ports, lifecycle, and network policy helpers

Not implemented yet:

- interactive PTY shell, matching the Python SDK limitation
- native streaming/detached process support; AI SDK `spawn()` is emulated through background shell execution and polling
- AI SDK custom network policies with CIDR allow/deny rules
- exhaustive client-side validation for every preview model
- generated OpenAPI-level model coverage
