import { Effect } from 'effect';

import { AcaSandboxError } from './errors.js';
import type { OperationPoller, PollUntilDoneOptions } from './poller.js';
import type { SandboxClient } from './sandboxClient.js';
import type { SandboxGroupClient } from './sandboxGroupClient.js';
import type {
  CreateSandboxOptions,
  DeleteFileOptions,
  DirListing,
  ExecOptions,
  ExecResult,
  FileInfo,
  FileOperationOptions,
  Sandbox,
  WriteFileOptions,
} from './types.js';

export type AcaSandboxEffectError = HttpError | UnknownError;

export type HttpError = {
  readonly _tag: 'HttpError';
  readonly cause: AcaSandboxError;
};

export type UnknownError = {
  readonly _tag: 'UnknownError';
  readonly cause: unknown;
};

export function toEffectError(cause: unknown): AcaSandboxEffectError {
  if (cause instanceof AcaSandboxError) {
    return { _tag: 'HttpError', cause };
  }
  return { _tag: 'UnknownError', cause };
}

export function tryPromise<T>(evaluate: () => Promise<T>): Effect.Effect<T, AcaSandboxEffectError> {
  return Effect.tryPromise({
    try: evaluate,
    catch: toEffectError,
  });
}

function mapSdkError<T>(
  effect: Effect.Effect<T, unknown>,
): Effect.Effect<T, AcaSandboxEffectError> {
  return Effect.mapError(effect, toEffectError);
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
  return Effect.suspend(() =>
    mapSdkError(client.beginCreateSandbox(options).pollUntilDoneEffect()),
  );
}

export function deleteSandbox(sandbox: SandboxClient): Effect.Effect<void, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.delete());
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

export function stop(sandbox: SandboxClient): Effect.Effect<void, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.stop());
}

export function resume(sandbox: SandboxClient): Effect.Effect<void, AcaSandboxEffectError> {
  return tryPromise(() => sandbox.resume());
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
  return Effect.acquireUseRelease(createSandbox(client, options), use, (sandbox) =>
    Effect.catchAll(deleteSandbox(sandbox), () => Effect.void),
  );
}
