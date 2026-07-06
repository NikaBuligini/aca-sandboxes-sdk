import type { HarnessV1NetworkSandboxSession, HarnessV1SandboxProvider } from '@ai-sdk/harness';
import type { Experimental_SandboxSession as SandboxSession } from '@ai-sdk/provider-utils';

import { SandboxClient } from '../sandboxClient.js';
import { SandboxGroupClient } from '../sandboxGroupClient.js';
import type { AddPortRequest, CreateSandboxOptions, Sandbox } from '../types.js';
import {
  AcaNetworkSandboxSession,
  normalizePortRequests,
  type AcaNetworkSandboxSessionOptions,
} from './networkSession.js';
import { ACA_PROVIDER_ID } from './util.js';

const SESSION_LABEL = 'ai-sdk-session';
const DEFAULT_WORKING_DIRECTORY = '/';

export type AcaSandboxSettings =
  | {
      sandbox: SandboxClient;
      bridgePorts?: ReadonlyArray<number>;
      defaultWorkingDirectory?: string;
      portDefaults?: Omit<AddPortRequest, 'port'>;
    }
  | (CreateSandboxOptions & {
      client: SandboxGroupClient;
      sandbox?: never;
      bridgePorts?: never;
      defaultWorkingDirectory?: string;
      portDefaults?: Omit<AddPortRequest, 'port'>;
    });

export function createAcaSandbox(settings: AcaSandboxSettings): HarnessV1SandboxProvider {
  return new AcaSandboxProvider(settings);
}

export class AcaSandboxProvider implements HarnessV1SandboxProvider {
  readonly specificationVersion = 'harness-sandbox-v1' as const;
  readonly providerId = ACA_PROVIDER_ID;
  readonly bridgePorts?: ReadonlyArray<number>;

  constructor(private readonly settings: AcaSandboxSettings) {
    if ('sandbox' in settings && settings.sandbox != null && settings.bridgePorts != null) {
      this.bridgePorts = [...settings.bridgePorts];
    }
  }

  createSession = async (options?: {
    sessionId?: string;
    abortSignal?: AbortSignal;
    identity?: string;
    onFirstCreate?: (session: SandboxSession, opts: { abortSignal?: AbortSignal }) => Promise<void>;
  }): Promise<HarnessV1NetworkSandboxSession> => {
    options?.abortSignal?.throwIfAborted();

    if ('sandbox' in this.settings && this.settings.sandbox != null) {
      return this.createNetworkSession({
        sandbox: this.settings.sandbox,
        ownsLifecycle: false,
        defaultWorkingDirectory:
          this.settings.defaultWorkingDirectory ??
          (await detectWorkingDirectory(this.settings.sandbox, options?.abortSignal)),
        portDefaults: this.settings.portDefaults,
      });
    }

    const { client, defaultWorkingDirectory, portDefaults, ...createOptions } = this.settings;
    const sandboxOptions: CreateSandboxOptions = {
      ...createOptions,
      labels: options?.sessionId
        ? { ...createOptions.labels, [SESSION_LABEL]: options.sessionId }
        : createOptions.labels,
      ports: normalizePortRequests(createOptions.ports, portDefaults),
    };
    const sandbox = await client.createSandbox(sandboxOptions).pollUntilDone({
      abortSignal: options?.abortSignal,
    });
    const workingDirectory =
      defaultWorkingDirectory ?? (await detectWorkingDirectory(sandbox, options?.abortSignal));
    const session = await this.createNetworkSession({
      sandbox,
      ownsLifecycle: true,
      defaultWorkingDirectory: workingDirectory,
      sandboxModel: await sandbox.get(),
      portDefaults,
    });

    if (options?.onFirstCreate != null) {
      await options.onFirstCreate(session.restricted(), { abortSignal: options.abortSignal });
    }
    return session;
  };

  resumeSession = async (options: {
    sessionId: string;
    abortSignal?: AbortSignal;
  }): Promise<HarnessV1NetworkSandboxSession> => {
    options.abortSignal?.throwIfAborted();

    if ('sandbox' in this.settings && this.settings.sandbox != null) {
      return this.createNetworkSession({
        sandbox: this.settings.sandbox,
        ownsLifecycle: false,
        defaultWorkingDirectory:
          this.settings.defaultWorkingDirectory ??
          (await detectWorkingDirectory(this.settings.sandbox, options.abortSignal)),
        portDefaults: this.settings.portDefaults,
      });
    }

    const sandboxModel = await findSessionSandbox(this.settings.client, options.sessionId);
    const sandbox = this.settings.client.sandbox(sandboxModel.id);
    await sandbox.ensureRunning({ abortSignal: options.abortSignal });
    return this.createNetworkSession({
      sandbox,
      ownsLifecycle: true,
      defaultWorkingDirectory:
        this.settings.defaultWorkingDirectory ??
        (await detectWorkingDirectory(sandbox, options.abortSignal)),
      sandboxModel: await sandbox.get(),
      portDefaults: this.settings.portDefaults,
    });
  };

  private async createNetworkSession(
    options: AcaNetworkSandboxSessionOptions,
  ): Promise<AcaNetworkSandboxSession> {
    return new AcaNetworkSandboxSession(options);
  }
}

async function findSessionSandbox(client: SandboxGroupClient, sessionId: string): Promise<Sandbox> {
  for await (const sandbox of client.listSandboxes({ labels: { [SESSION_LABEL]: sessionId } })) {
    const state = sandbox.state?.toLowerCase();

    if (state !== 'deleting' && state !== 'failed') {
      return sandbox;
    }
  }
  throw new Error(`No ACA sandbox found for AI SDK session ${sessionId}.`);
}

async function detectWorkingDirectory(
  sandbox: SandboxClient,
  abortSignal?: AbortSignal,
): Promise<string> {
  try {
    const result = await sandbox.exec('pwd', { abortSignal });
    const cwd = result.stdout.trim();

    if (cwd) {
      return cwd;
    }
  } catch {
    // A stable fallback is better than failing provider creation for older images.
  }
  return DEFAULT_WORKING_DIRECTORY;
}
