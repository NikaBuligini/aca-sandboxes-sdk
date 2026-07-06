import {
  HarnessCapabilityUnsupportedError,
  type HarnessV1NetworkPolicy,
  type HarnessV1NetworkSandboxSession,
} from '@ai-sdk/harness';
import type { Experimental_SandboxSession as SandboxSession } from '@ai-sdk/provider-utils';

import type { SandboxClient } from '../sandboxClient.js';
import type { AddPortRequest, Sandbox } from '../types.js';
import { toAcaEgressPolicy } from './networkPolicy.js';
import { AcaSandboxSession } from './session.js';
import { ACA_PROVIDER_ID } from './util.js';

export type AcaNetworkSandboxSessionOptions = {
  sandbox: SandboxClient;
  ownsLifecycle: boolean;
  defaultWorkingDirectory: string;
  sandboxModel?: Sandbox;
  portDefaults?: Omit<AddPortRequest, 'port'>;
};

export class AcaNetworkSandboxSession
  extends AcaSandboxSession
  implements HarnessV1NetworkSandboxSession
{
  readonly id: string;
  readonly defaultWorkingDirectory: string;
  private readonly ownsLifecycle: boolean;
  private readonly portDefaults: Omit<AddPortRequest, 'port'>;
  private sandboxModel?: Sandbox;

  constructor(options: AcaNetworkSandboxSessionOptions) {
    super(options.sandbox, options.defaultWorkingDirectory);
    this.id = options.sandbox.id;
    this.defaultWorkingDirectory = options.defaultWorkingDirectory;
    this.ownsLifecycle = options.ownsLifecycle;
    this.sandboxModel = options.sandboxModel;
    this.portDefaults = options.portDefaults ?? { auth: { anonymous: true } };
  }

  get ports(): ReadonlyArray<number> {
    return (this.sandboxModel?.ports ?? []).map((port) => port.port);
  }

  restricted(): SandboxSession {
    return new AcaSandboxSession(this.sandbox, this.defaultWorkingDirectory);
  }

  getPortUrl = async (options: {
    port: number;
    protocol?: 'http' | 'https' | 'ws';
  }): Promise<string> => {
    const sandbox = await this.refreshSandbox();
    const exposed = sandbox.ports ?? [];
    const port = exposed.find((entry) => entry.port === options.port);

    if (!port?.url) {
      throw new HarnessCapabilityUnsupportedError({
        harnessId: ACA_PROVIDER_ID,
        message: `Port ${options.port} is not exposed on this sandbox. Exposed ports: [${exposed.map((entry) => entry.port).join(', ')}].`,
      });
    }

    const url = new URL(port.url);
    const isSecure = url.protocol === 'https:';

    switch (options.protocol ?? 'https') {
      case 'http':
        url.protocol = isSecure ? 'https:' : 'http:';
        break;
      case 'https':
        url.protocol = 'https:';
        break;
      case 'ws':
        url.protocol = isSecure ? 'wss:' : 'ws:';
        break;
    }
    return url.toString();
  };

  setNetworkPolicy = async (policy: HarnessV1NetworkPolicy): Promise<void> => {
    await this.sandbox.setEgressPolicy(toAcaEgressPolicy(policy));
    this.sandboxModel = await this.sandbox.get();
  };

  setPorts = async (
    ports: ReadonlyArray<number>,
    options?: { abortSignal?: AbortSignal },
  ): Promise<void> => {
    options?.abortSignal?.throwIfAborted();
    const updated = await this.sandbox.updatePorts(
      ports.map((port) => ({ ...this.portDefaults, port })),
    );
    this.sandboxModel = {
      ...(this.sandboxModel ?? { id: this.sandbox.id }),
      ports: updated,
    };
  };

  stop = async (): Promise<void> => {
    if (!this.ownsLifecycle) {
      return;
    }
    await this.sandbox.stop().pollUntilDone();
    this.sandboxModel = await this.sandbox.get().catch(() => this.sandboxModel);
  };

  destroy = async (): Promise<void> => {
    if (!this.ownsLifecycle) {
      return;
    }
    await this.sandbox.delete().pollUntilDone();
  };

  private async refreshSandbox(): Promise<Sandbox> {
    this.sandboxModel = await this.sandbox.get();
    return this.sandboxModel;
  }
}

export function normalizePortRequests(
  ports: Array<AddPortRequest | number> | undefined,
  portDefaults: Omit<AddPortRequest, 'port'> | undefined,
): Array<AddPortRequest | number> | undefined {
  if (ports == null) {
    return undefined;
  }

  const defaults = portDefaults ?? { auth: { anonymous: true } };
  return ports.map((port) => (typeof port === 'number' ? { ...defaults, port } : port));
}
