import { Data } from 'effect';

export class AcaSandboxError extends Data.TaggedError('AcaSandboxError')<{
  readonly message: string;
  readonly statusCode: number;
  readonly responseBody: unknown;
}> {
  constructor(args: {
    readonly message: string;
    readonly statusCode: number;
    readonly responseBody: unknown;
  });
  constructor(message: string, statusCode: number, responseBody: unknown);
  constructor(
    argsOrMessage:
      | { readonly message: string; readonly statusCode: number; readonly responseBody: unknown }
      | string,
    statusCode?: number,
    responseBody?: unknown,
  ) {
    super(
      typeof argsOrMessage === 'string'
        ? { message: argsOrMessage, statusCode: statusCode as number, responseBody }
        : argsOrMessage,
    );
    this.name = 'AcaSandboxError';
  }
}

export class CommandFailedError extends Data.TaggedError('CommandFailedError')<{
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  constructor(args: {
    readonly command: string;
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  });
  constructor(command: string, exitCode: number, stdout: string, stderr: string);
  constructor(
    argsOrCommand:
      | {
          readonly command: string;
          readonly exitCode: number;
          readonly stdout: string;
          readonly stderr: string;
        }
      | string,
    exitCode?: number,
    stdout?: string,
    stderr?: string,
  ) {
    super(
      typeof argsOrCommand === 'string'
        ? {
            command: argsOrCommand,
            exitCode: exitCode as number,
            stdout: stdout as string,
            stderr: stderr as string,
          }
        : argsOrCommand,
    );
    this.name = 'CommandFailedError';
  }

  override get message(): string {
    return `Command failed with exit code ${this.exitCode}: ${this.command}`;
  }
}

export class CredentialError extends Data.TaggedError('CredentialError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  constructor(args: { readonly message: string; readonly cause?: unknown }) {
    super(args);
    this.name = 'CredentialError';
  }
}

export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly message: string;
  readonly cause: unknown;
}> {
  constructor(args: { readonly message: string; readonly cause: unknown }) {
    super(args);
    this.name = 'NetworkError';
  }
}

export class PollTimeoutError extends Data.TaggedError('PollTimeoutError')<{
  readonly timeoutInMs: number;
  readonly lastStatus?: string;
}> {
  constructor(args: { readonly timeoutInMs: number; readonly lastStatus?: string }) {
    super(args);
    this.name = 'PollTimeoutError';
  }

  override get message(): string {
    return `Operation did not complete within ${this.timeoutInMs}ms. Last status: ${this.lastStatus ?? 'unknown'}.`;
  }
}

export class OperationFailedError extends Data.TaggedError('OperationFailedError')<{
  readonly message: string;
  readonly status?: string;
  readonly details?: unknown;
}> {
  constructor(args: {
    readonly message: string;
    readonly status?: string;
    readonly details?: unknown;
  }) {
    super(args);
    this.name = 'OperationFailedError';
  }
}

export type AcaSandboxSdkError =
  | AcaSandboxError
  | CommandFailedError
  | CredentialError
  | NetworkError
  | PollTimeoutError
  | OperationFailedError;

export function isNotFoundError(error: unknown): boolean {
  return error instanceof AcaSandboxError && error.statusCode === 404;
}
