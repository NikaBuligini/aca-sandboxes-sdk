import { Config, Context, Effect, Layer, Scope, Stream } from 'effect';

import {
  AcaSandboxError,
  type AcaSandboxSdkError,
  CommandFailedError,
  CredentialError,
  NetworkError,
  OperationFailedError,
  PollTimeoutError,
} from './errors.js';
import type { OperationPoller, PollUntilDoneOptions } from './poller.js';
import type { SandboxClient } from './sandboxClient.js';
import { SandboxGroupClient } from './sandboxGroupClient.js';
import type {
  CreateSandboxOptions,
  DeleteFileOptions,
  DiskImage,
  DirListing,
  ExecOptions,
  ExecResult,
  FileInfo,
  FileOperationOptions,
  ListSandboxesOptions,
  PublicDiskImage,
  Sandbox,
  SandboxGroupClientOptions,
  SecretMetadata,
  Snapshot,
  TokenCredential,
  Volume,
  WriteFileOptions,
} from './types.js';

export type AcaSandboxEffectError = AcaSandboxSdkError;

export function toSdkError(cause: unknown): AcaSandboxEffectError {
  if (
    cause instanceof AcaSandboxError ||
    cause instanceof CommandFailedError ||
    cause instanceof CredentialError ||
    cause instanceof NetworkError ||
    cause instanceof OperationFailedError ||
    cause instanceof PollTimeoutError
  ) {
    return cause;
  }

  const message = cause instanceof Error ? cause.message : 'ACA sandboxes operation failed.';
  return new OperationFailedError({ message, details: cause });
}

export function tryPromise<T>(evaluate: () => Promise<T>): Effect.Effect<T, AcaSandboxEffectError> {
  return Effect.tryPromise({
    try: evaluate,
    catch: toSdkError,
  });
}

function mapSdkError<T>(
  effect: Effect.Effect<T, unknown>,
): Effect.Effect<T, AcaSandboxEffectError> {
  return Effect.mapError(effect, toSdkError);
}

export function pollUntilDone<T>(
  poller: OperationPoller<T>,
  options?: PollUntilDoneOptions,
): Effect.Effect<T, AcaSandboxEffectError> {
  return mapSdkError(poller.pollUntilDoneEffect(options));
}

export function getSandbox(sandbox: SandboxClient): Effect.Effect<Sandbox, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.get());
}

export function createSandbox(
  client: SandboxGroupClient,
  options: CreateSandboxOptions = {},
): Effect.Effect<SandboxClient, AcaSandboxEffectError> {
  return Effect.suspend(() => mapSdkError(client.createSandbox(options).pollUntilDoneEffect()));
}

export function deleteSandbox(sandbox: SandboxClient): Effect.Effect<void, AcaSandboxEffectError> {
  return Effect.suspend(() => mapSdkError(sandbox.delete().pollUntilDoneEffect()));
}

export function exec(
  sandbox: SandboxClient,
  command: string,
  options: ExecOptions = {},
): Effect.Effect<ExecResult, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.exec(command, options));
}

export function listFiles(
  sandbox: SandboxClient,
  path = '/',
  options: FileOperationOptions = {},
): Effect.Effect<DirListing, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.listFiles(path, options));
}

export function statFile(
  sandbox: SandboxClient,
  path: string,
  options: FileOperationOptions = {},
): Effect.Effect<FileInfo, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.statFile(path, options));
}

export function readFile(
  sandbox: SandboxClient,
  path: string,
  options: FileOperationOptions = {},
): Effect.Effect<Uint8Array, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.readFile(path, options));
}

export function readTextFile(
  sandbox: SandboxClient,
  path: string,
  options: FileOperationOptions = {},
): Effect.Effect<string, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.readTextFile(path, options));
}

export function writeFile(
  sandbox: SandboxClient,
  path: string,
  content: string | ArrayBuffer | Uint8Array,
  options: WriteFileOptions = {},
): Effect.Effect<void, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.writeFile(path, content, options));
}

export function deleteFile(
  sandbox: SandboxClient,
  path: string,
  options: DeleteFileOptions = {},
): Effect.Effect<void, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.deleteFile(path, options));
}

export function stop(sandbox: SandboxClient): Effect.Effect<Sandbox, AcaSandboxEffectError> {
  return Effect.suspend(() => mapSdkError(sandbox.stop().pollUntilDoneEffect()));
}

export function resume(sandbox: SandboxClient): Effect.Effect<Sandbox, AcaSandboxEffectError> {
  return Effect.suspend(() => mapSdkError(sandbox.resume().pollUntilDoneEffect()));
}

export function waitForRunning(
  sandbox: SandboxClient,
  options: { timeoutInMs?: number; intervalInMs?: number; abortSignal?: AbortSignal } = {},
): Effect.Effect<Sandbox, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.waitForRunning(options));
}

export function ensureRunning(
  sandbox: SandboxClient,
  options: { timeoutInMs?: number; intervalInMs?: number; abortSignal?: AbortSignal } = {},
): Effect.Effect<void, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.ensureRunning(options));
}

export function withSandbox<A, E, R>(
  client: SandboxGroupClient,
  options: CreateSandboxOptions,
  use: (sandbox: SandboxClient) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | AcaSandboxEffectError, R> {
  return Effect.scoped(Effect.flatMap(acquireSandbox(client, options), use));
}

export function acquireSandbox(
  client: SandboxGroupClient,
  options: CreateSandboxOptions,
): Effect.Effect<SandboxClient, AcaSandboxEffectError, Scope.Scope> {
  return Effect.acquireRelease(createSandbox(client, options), (sandbox) =>
    deleteSandbox(sandbox).pipe(
      Effect.catchAll((error) =>
        Effect.logWarning(`Failed to delete sandbox during scope release: ${error.message}`),
      ),
    ),
  );
}

export function listSandboxes(
  client: SandboxGroupClient,
  options: ListSandboxesOptions = {},
): Stream.Stream<Sandbox, AcaSandboxEffectError> {
  return streamFromAsyncIterable(client.listSandboxes(options));
}

export function listDiskImages(
  client: SandboxGroupClient,
): Stream.Stream<DiskImage, AcaSandboxEffectError> {
  return streamFromAsyncIterable(client.listDiskImages());
}

export function listPublicDiskImages(
  client: SandboxGroupClient,
): Stream.Stream<PublicDiskImage, AcaSandboxEffectError> {
  return streamFromAsyncIterable(client.listPublicDiskImages());
}

export function listSnapshots(
  client: SandboxGroupClient,
): Stream.Stream<Snapshot, AcaSandboxEffectError> {
  return streamFromAsyncIterable(client.listSnapshots());
}

export function listVolumes(
  client: SandboxGroupClient,
): Stream.Stream<Volume, AcaSandboxEffectError> {
  return streamFromAsyncIterable(client.listVolumes());
}

export function listSecrets(
  client: SandboxGroupClient,
): Stream.Stream<SecretMetadata, AcaSandboxEffectError> {
  return streamFromAsyncIterable(client.listSecrets());
}

export class AzureCredential extends Context.Tag('aca-sandboxes-sdk/AzureCredential')<
  AzureCredential,
  TokenCredential
>() {}

export type AcaSandboxesService = {
  readonly client: SandboxGroupClient;
  readonly sandbox: (sandboxId: string) => SandboxClient;
  readonly createSandbox: (
    options?: CreateSandboxOptions,
  ) => Effect.Effect<SandboxClient, AcaSandboxEffectError>;
  readonly acquireSandbox: (
    options?: CreateSandboxOptions,
  ) => Effect.Effect<SandboxClient, AcaSandboxEffectError, Scope.Scope>;
  readonly listSandboxes: (
    options?: ListSandboxesOptions,
  ) => Stream.Stream<Sandbox, AcaSandboxEffectError>;
};

export class AcaSandboxes extends Context.Tag('aca-sandboxes-sdk/AcaSandboxes')<
  AcaSandboxes,
  AcaSandboxesService
>() {
  static layer(options: SandboxGroupClientOptions) {
    return Layer.succeed(AcaSandboxes, makeAcaSandboxes(new SandboxGroupClient(options)));
  }

  static layerClient(client: SandboxGroupClient) {
    return Layer.succeed(AcaSandboxes, makeAcaSandboxes(client));
  }

  static layerConfig(
    options: Partial<
      Omit<
        SandboxGroupClientOptions,
        'credential' | 'subscriptionId' | 'resourceGroup' | 'sandboxGroup'
      >
    > &
      Partial<
        Pick<SandboxGroupClientOptions, 'subscriptionId' | 'resourceGroup' | 'sandboxGroup'>
      > = {},
  ) {
    return Layer.effect(
      AcaSandboxes,
      Effect.gen(function* () {
        const credential = yield* AzureCredential;
        const subscriptionId =
          options.subscriptionId ?? (yield* Config.string('AZURE_SUBSCRIPTION_ID'));
        const resourceGroup =
          options.resourceGroup ?? (yield* Config.string('AZURE_RESOURCE_GROUP'));
        const sandboxGroup = options.sandboxGroup ?? (yield* Config.string('AZURE_SANDBOX_GROUP'));
        const region =
          options.region ?? (options.endpoint ? undefined : yield* optionalConfig('AZURE_REGION'));

        return makeAcaSandboxes(
          new SandboxGroupClient({
            ...options,
            credential,
            subscriptionId,
            resourceGroup,
            sandboxGroup,
            region,
          }),
        );
      }),
    );
  }
}

function makeAcaSandboxes(client: SandboxGroupClient): AcaSandboxesService {
  return {
    client,
    sandbox: (sandboxId) => client.sandbox(sandboxId),
    createSandbox: (options = {}) => createSandbox(client, options),
    acquireSandbox: (options = {}) => acquireSandbox(client, options),
    listSandboxes: (options = {}) => listSandboxes(client, options),
  };
}

function streamFromAsyncIterable<T>(
  iterable: AsyncIterable<T>,
): Stream.Stream<T, AcaSandboxEffectError> {
  return Stream.fromAsyncIterable(iterable, toSdkError);
}

function optionalConfig(name: string): Config.Config<string | undefined> {
  return Config.string(name).pipe(Config.withDefault(undefined));
}
