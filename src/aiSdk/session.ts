import {
  extractLines,
  type Experimental_SandboxProcess as SandboxProcess,
  type Experimental_SandboxSession as SandboxSession,
} from '@ai-sdk/provider-utils';

import type { SandboxClient } from '../sandboxClient.js';
import { createAcaSandboxProcess } from './process.js';
import {
  bytesToStream,
  collectStream,
  commandWithEnv,
  shouldReturnNullForRead,
  throwIfAborted,
} from './util.js';

const ENSURE_RUNNING_TTL_MS = 5_000;

export class AcaSandboxSession implements SandboxSession {
  private lastEnsureRunningAt = 0;

  constructor(
    protected readonly sandbox: SandboxClient,
    protected readonly defaultWorkingDirectoryValue: string,
  ) {}

  get description(): string {
    return [
      `Azure Container Apps sandbox (id: ${this.sandbox.id}).`,
      `Default working directory: ${this.defaultWorkingDirectoryValue}.`,
      'Filesystem changes persist for the lifetime of the sandbox.',
    ].join('\n');
  }

  async run(options: {
    command: string;
    workingDirectory?: string;
    env?: Record<string, string>;
    abortSignal?: AbortSignal;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    throwIfAborted(options.abortSignal);
    await this.ensureRunning(options.abortSignal);
    return this.sandbox.exec(commandWithEnv(options.command, options.env), {
      workingDirectory: options.workingDirectory,
      abortSignal: options.abortSignal,
    });
  }

  async spawn(options: {
    command: string;
    workingDirectory?: string;
    env?: Record<string, string>;
    abortSignal?: AbortSignal;
  }): Promise<SandboxProcess> {
    throwIfAborted(options.abortSignal);
    await this.ensureRunning(options.abortSignal);
    return createAcaSandboxProcess(this.sandbox, options);
  }

  async readFile(options: {
    path: string;
    abortSignal?: AbortSignal;
  }): Promise<ReadableStream<Uint8Array> | null> {
    const bytes = await this.readBinaryFile(options);
    return bytes == null ? null : bytesToStream(bytes);
  }

  async readBinaryFile(options: {
    path: string;
    abortSignal?: AbortSignal;
  }): Promise<Uint8Array | null> {
    throwIfAborted(options.abortSignal);
    await this.ensureRunning(options.abortSignal);

    try {
      return await this.sandbox.readFile(options.path, { abortSignal: options.abortSignal });
    } catch (error) {
      if (shouldReturnNullForRead(error)) {
        return null;
      }
      throw error;
    }
  }

  async readTextFile(options: {
    path: string;
    encoding?: string;
    startLine?: number;
    endLine?: number;
    abortSignal?: AbortSignal;
  }): Promise<string | null> {
    const bytes = await this.readBinaryFile(options);

    if (bytes == null) {
      return null;
    }

    const text = new TextDecoder(options.encoding ?? 'utf-8').decode(bytes);
    return extractLines({ text, startLine: options.startLine, endLine: options.endLine });
  }

  async writeFile(options: {
    path: string;
    content: ReadableStream<Uint8Array>;
    abortSignal?: AbortSignal;
  }): Promise<void> {
    await this.writeBinaryFile({
      path: options.path,
      content: await collectStream(options.content),
      abortSignal: options.abortSignal,
    });
  }

  async writeBinaryFile(options: {
    path: string;
    content: Uint8Array;
    abortSignal?: AbortSignal;
  }): Promise<void> {
    throwIfAborted(options.abortSignal);
    await this.ensureRunning(options.abortSignal);
    await this.sandbox.writeFile(options.path, options.content, {
      createDirs: true,
      abortSignal: options.abortSignal,
    });
  }

  async writeTextFile(options: {
    path: string;
    content: string;
    encoding?: string;
    abortSignal?: AbortSignal;
  }): Promise<void> {
    const encoding = options.encoding ?? 'utf-8';

    if (encoding.toLowerCase() !== 'utf-8' && encoding.toLowerCase() !== 'utf8') {
      throw new Error('ACA sandbox text writes currently support only utf-8 encoding.');
    }
    await this.writeBinaryFile({
      path: options.path,
      content: new TextEncoder().encode(options.content),
      abortSignal: options.abortSignal,
    });
  }

  protected async ensureRunning(abortSignal?: AbortSignal): Promise<void> {
    const now = Date.now();

    if (now - this.lastEnsureRunningAt < ENSURE_RUNNING_TTL_MS) {
      return;
    }
    await this.sandbox.ensureRunning({ abortSignal });
    this.lastEnsureRunningAt = Date.now();
  }
}
