import type { Experimental_SandboxProcess as SandboxProcess } from '@ai-sdk/provider-utils';

import type { SandboxClient } from '../sandboxClient.js';
import { commandWithEnv, randomId, shellQuote, throwIfAborted } from './util.js';

const PROCESS_ROOT = '/tmp/.aca-ai-sdk';
const POLL_INTERVAL_MS = 500;

export function createAcaSandboxProcess(
  sandbox: SandboxClient,
  options: {
    command: string;
    workingDirectory?: string;
    env?: Record<string, string>;
    abortSignal?: AbortSignal;
  },
): Promise<SandboxProcess> {
  return AcaSandboxProcess.start(sandbox, options);
}

class AcaSandboxProcess implements SandboxProcess {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;

  private readonly encoder = new TextEncoder();
  private readonly stdoutController: Promise<ReadableStreamDefaultController<Uint8Array>>;
  private readonly stderrController: Promise<ReadableStreamDefaultController<Uint8Array>>;
  private readonly dir = `${PROCESS_ROOT}/${randomId()}`;
  private readonly outPath = `${this.dir}/stdout`;
  private readonly errPath = `${this.dir}/stderr`;
  private readonly exitPath = `${this.dir}/exit`;
  private readonly pidPath = `${this.dir}/pid`;
  private readonly started: Promise<void>;
  private readonly drained: Promise<void>;
  private stdoutOffset = 0;
  private stderrOffset = 0;
  private abortedReason: unknown;

  private constructor(
    private readonly sandbox: SandboxClient,
    private readonly options: {
      command: string;
      workingDirectory?: string;
      env?: Record<string, string>;
      abortSignal?: AbortSignal;
    },
  ) {
    const stdoutController = deferred<ReadableStreamDefaultController<Uint8Array>>();
    const stderrController = deferred<ReadableStreamDefaultController<Uint8Array>>();
    this.stdoutController = stdoutController.promise;
    this.stderrController = stderrController.promise;
    this.stdout = new ReadableStream<Uint8Array>({ start: stdoutController.resolve });
    this.stderr = new ReadableStream<Uint8Array>({ start: stderrController.resolve });
    this.started = this.startCommand();
    this.drained = this.drain();

    options.abortSignal?.addEventListener(
      'abort',
      () => {
        this.abortedReason =
          options.abortSignal?.reason ?? new DOMException('Aborted', 'AbortError');
        void this.kill().catch(() => undefined);
      },
      { once: true },
    );
  }

  static async start(
    sandbox: SandboxClient,
    options: {
      command: string;
      workingDirectory?: string;
      env?: Record<string, string>;
      abortSignal?: AbortSignal;
    },
  ): Promise<SandboxProcess> {
    throwIfAborted(options.abortSignal);
    const process = new AcaSandboxProcess(sandbox, options);
    await process.started;
    return process;
  }

  async wait(): Promise<{ exitCode: number }> {
    await this.started;
    const exitCode = await this.pollUntilExit();
    await this.drained;

    if (this.abortedReason !== undefined) {
      throw this.abortedReason;
    }
    return { exitCode };
  }

  async kill(): Promise<void> {
    await this.started.catch(() => undefined);
    await this.sandbox.exec(
      [
        `if test -f ${shellQuote(this.pidPath)}; then`,
        `pid=$(cat ${shellQuote(this.pidPath)} 2>/dev/null || true);`,
        'if test -n "$pid"; then',
        'kill -TERM -- -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true;',
        'fi;',
        'fi',
      ].join(' '),
    );
  }

  private async startCommand(): Promise<void> {
    const workdir = this.options.workingDirectory;
    const inner = [
      `echo $$ > ${shellQuote(this.pidPath)}`,
      commandWithEnv(this.options.command, this.options.env),
      `code=$?`,
      `printf '%s' "$code" > ${shellQuote(this.exitPath)}`,
    ].join('; ');

    const command = [
      `mkdir -p ${shellQuote(this.dir)}`,
      `: > ${shellQuote(this.outPath)}`,
      `: > ${shellQuote(this.errPath)}`,
      `rm -f ${shellQuote(this.exitPath)} ${shellQuote(this.pidPath)}`,
      `${workdir ? `cd ${shellQuote(workdir)} && ` : ''}nohup setsid bash -lc ${shellQuote(inner)} > ${shellQuote(this.outPath)} 2> ${shellQuote(this.errPath)} < /dev/null &`,
    ].join(' && ');

    await this.sandbox.exec(command, { abortSignal: this.options.abortSignal, check: true });
  }

  private async drain(): Promise<void> {
    const stdout = await this.stdoutController;
    const stderr = await this.stderrController;

    try {
      await this.started;

      while (true) {
        const [stdoutChunk, stderrChunk, status] = await Promise.all([
          this.readNewOutput(this.outPath, this.stdoutOffset),
          this.readNewOutput(this.errPath, this.stderrOffset),
          this.readStatus(),
        ]);

        if (stdoutChunk.length > 0) {
          const bytes = this.encoder.encode(stdoutChunk);
          this.stdoutOffset += bytes.byteLength;
          stdout.enqueue(bytes);
        }

        if (stderrChunk.length > 0) {
          const bytes = this.encoder.encode(stderrChunk);
          this.stderrOffset += bytes.byteLength;
          stderr.enqueue(bytes);
        }

        if (status !== 'RUNNING') {
          stdout.close();
          stderr.close();
          return;
        }
        await sleep(POLL_INTERVAL_MS, this.options.abortSignal);
      }
    } catch (error) {
      stdout.error(error);
      stderr.error(error);
    }
  }

  private async pollUntilExit(): Promise<number> {
    while (true) {
      const status = await this.readStatus();

      if (status !== 'RUNNING') {
        return Number.parseInt(status, 10) || 0;
      }
      await sleep(POLL_INTERVAL_MS, this.options.abortSignal);
    }
  }

  private async readNewOutput(path: string, offset: number): Promise<string> {
    const result = await this.sandbox.exec(
      `if test -f ${shellQuote(path)}; then tail -c +${offset + 1} ${shellQuote(path)}; fi`,
    );
    return result.stdout;
  }

  private async readStatus(): Promise<string> {
    const result = await this.sandbox.exec(
      [
        `if test -f ${shellQuote(this.exitPath)}; then`,
        `cat ${shellQuote(this.exitPath)};`,
        `elif test -f ${shellQuote(this.pidPath)} && kill -0 "$(cat ${shellQuote(this.pidPath)})" 2>/dev/null; then`,
        'printf RUNNING;',
        'else',
        'printf 143;',
        'fi',
      ].join(' '),
    );
    return result.stdout.trim();
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) {
    return Promise.reject(abortSignal.reason ?? new DOMException('Aborted', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    abortSignal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(abortSignal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
