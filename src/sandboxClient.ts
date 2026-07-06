import { DATA_PLANE_BASE, DATA_PLANE_SCOPE, DEFAULT_API_VERSION } from './constants.js';
import { isNotFoundError } from './errors.js';
import { RestClient } from './http.js';
import { OperationPoller, statePoller } from './poller.js';
import type {
  AddPortRequest,
  AddVolumeMountRequest,
  DeleteFileOptions,
  DirListing,
  DiskImage,
  EgressDecisions,
  EgressHeader,
  EgressPolicy,
  ExecOptions,
  ExecResult,
  FileInfo,
  FileOperationOptions,
  LifecyclePolicy,
  Sandbox,
  SandboxClientOptions,
  SandboxPort,
  SandboxStats,
  TokenCredential,
  Snapshot,
  WriteFileOptions,
} from './types.js';
import { boolParam, pathSegment, toUint8Array, validatePathSegment } from './util.js';

const RESUMABLE_STATES = new Set(['stopped', 'suspended', 'idle']);
const TERMINAL_STATES = new Set(['deleting', 'failed']);

export class SandboxClient {
  readonly subscriptionId: string;
  readonly resourceGroup: string;
  readonly sandboxGroup: string;
  readonly sandboxId: string;

  private readonly rest: RestClient;

  constructor(endpoint: string, credential: TokenCredential, options: SandboxClientOptions);
  constructor(rest: RestClient, options: SandboxClientOptions);
  constructor(
    endpointOrRest: string | RestClient,
    credentialOrOptions: TokenCredential | SandboxClientOptions,
    maybeOptions?: SandboxClientOptions,
  ) {
    const options = maybeOptions ?? (credentialOrOptions as SandboxClientOptions);
    this.subscriptionId = options.subscriptionId;
    this.resourceGroup = validatePathSegment(options.resourceGroup, 'resourceGroup');
    this.sandboxGroup = validatePathSegment(options.sandboxGroup, 'sandboxGroup');
    this.sandboxId = validatePathSegment(options.sandboxId, 'sandboxId');

    this.rest =
      endpointOrRest instanceof RestClient
        ? endpointOrRest
        : new RestClient({
            endpoint: endpointOrRest || DATA_PLANE_BASE,
            credential: credentialOrOptions as TokenCredential,
            scope: options.audience ?? DATA_PLANE_SCOPE,
            apiVersion: options.apiVersion ?? DEFAULT_API_VERSION,
            fetch: options.fetch,
          });
  }

  get groupPath(): string {
    return `/subscriptions/${encodeURIComponent(this.subscriptionId)}/resourceGroups/${pathSegment(this.resourceGroup, 'resourceGroup')}/sandboxGroups/${pathSegment(this.sandboxGroup, 'sandboxGroup')}`;
  }

  get sandboxPath(): string {
    return `${this.groupPath}/sandboxes/${pathSegment(this.sandboxId, 'sandboxId')}`;
  }

  async get(): Promise<Sandbox> {
    return this.rest.request<Sandbox>('GET', this.sandboxPath);
  }

  async delete(): Promise<void> {
    await this.rest.request('DELETE', this.sandboxPath, {
      responseType: 'void',
      allowedStatusCodes: [202],
    });
  }

  beginDelete(): OperationPoller<void> {
    let started = false;
    return new OperationPoller(async () => {
      if (!started) {
        started = true;
        await this.delete();
      }

      try {
        await this.get();
        return { done: false, status: 'Deleting' };
      } catch (error) {
        if (isNotFoundError(error)) {
          return { done: true, status: 'Deleted', result: undefined };
        }
        throw error;
      }
    });
  }

  async stop(): Promise<void> {
    await this.rest.request('POST', `${this.sandboxPath}/stop`, { responseType: 'void' });
  }

  beginStop(): OperationPoller<Sandbox> {
    let started = false;
    return statePoller({
      getResource: async () => {
        if (!started) {
          started = true;
          await this.stop();
        }
        return this.get();
      },
      getState: (sandbox) => sandbox.state,
      targetStates: ['Stopped', 'Suspended', 'Idle'],
      failedStates: ['Failed'],
      transform: (sandbox) => sandbox,
    });
  }

  async resume(): Promise<void> {
    await this.rest.request('POST', `${this.sandboxPath}/resume`, { responseType: 'void' });
  }

  beginResume(): OperationPoller<Sandbox> {
    let started = false;
    return statePoller({
      getResource: async () => {
        if (!started) {
          started = true;
          await this.resume();
        }
        return this.get();
      },
      getState: (sandbox) => sandbox.state,
      targetStates: ['Running'],
      failedStates: ['Failed', 'Deleting'],
      transform: (sandbox) => sandbox,
    });
  }

  async waitForRunning(
    options: { timeoutInMs?: number; intervalInMs?: number; abortSignal?: AbortSignal } = {},
  ): Promise<Sandbox> {
    return statePoller({
      getResource: () => this.get(),
      getState: (sandbox) => sandbox.state,
      targetStates: ['Running'],
      failedStates: ['Failed', 'Deleting'],
      transform: (sandbox) => sandbox,
    }).pollUntilDone(options);
  }

  async ensureRunning(
    options: { timeoutInMs?: number; intervalInMs?: number; abortSignal?: AbortSignal } = {},
  ): Promise<void> {
    const sandbox = await this.get();
    const state = sandbox.state?.toLowerCase();

    if (state === 'running') {
      return;
    }

    if (state && TERMINAL_STATES.has(state)) {
      throw new Error(
        `Sandbox ${this.sandboxId} is in '${sandbox.state}' state and cannot be resumed.`,
      );
    }

    if (state && RESUMABLE_STATES.has(state)) {
      await this.resume();
      await this.waitForRunning(options);
      return;
    }
    throw new Error(
      `Sandbox ${this.sandboxId} is in unexpected state '${sandbox.state ?? 'unknown'}'.`,
    );
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const body: Record<string, unknown> = { command };

    if (options.workingDirectory) {
      body.workingDirectory = options.workingDirectory;
    }
    return this.rest.request<ExecResult>('POST', `${this.sandboxPath}/executeShellCommand`, {
      body,
    });
  }

  async listFiles(path = '/', options: FileOperationOptions = {}): Promise<DirListing> {
    return this.rest.request<DirListing>('GET', `${this.sandboxPath}/files/list`, {
      params: { path, containerName: options.containerName },
    });
  }

  async statFile(path: string, options: FileOperationOptions = {}): Promise<FileInfo> {
    return this.rest.request<FileInfo>('GET', `${this.sandboxPath}/files/stat`, {
      params: { path, containerName: options.containerName },
    });
  }

  async readFile(path: string, options: FileOperationOptions = {}): Promise<Uint8Array> {
    return this.rest.request<Uint8Array>('GET', `${this.sandboxPath}/files`, {
      params: { path, containerName: options.containerName },
      responseType: 'binary',
    });
  }

  async readTextFile(path: string, options: FileOperationOptions = {}): Promise<string> {
    return new TextDecoder().decode(await this.readFile(path, options));
  }

  async writeFile(
    path: string,
    content: string | ArrayBuffer | Uint8Array,
    options: WriteFileOptions = {},
  ): Promise<void> {
    await this.rest.request('PUT', `${this.sandboxPath}/files`, {
      params: {
        path,
        createDirs: boolParam(options.createDirs ?? true),
        mode: options.mode,
        containerName: options.containerName,
      },
      headers: { 'Content-Type': 'application/octet-stream' },
      body: toUint8Array(content),
      responseType: 'void',
    });
  }

  async deleteFile(path: string, options: DeleteFileOptions = {}): Promise<void> {
    await this.rest.request('DELETE', `${this.sandboxPath}/files`, {
      params: {
        path,
        recursive: boolParam(options.recursive ?? false),
        containerName: options.containerName,
      },
      responseType: 'void',
    });
  }

  async mkdir(path: string, options: FileOperationOptions = {}): Promise<void> {
    await this.rest.request('POST', `${this.sandboxPath}/files/mkdir`, {
      params: { containerName: options.containerName },
      body: { path },
      responseType: 'void',
    });
  }

  async addPort(
    port: number,
    options: {
      anonymous?: boolean;
      email?: string;
      ipAccessControl?: AddPortRequest['ipAccessControl'];
    } = {},
  ): Promise<SandboxPort> {
    const body: AddPortRequest = { port };

    if (options.anonymous) {
      body.auth = { anonymous: true };
    } else if (options.email) {
      body.auth = { entraId: { enabled: true, emails: [options.email] } };
    }

    if (options.ipAccessControl) {
      body.ipAccessControl = options.ipAccessControl;
    }

    const response = await this.rest.request<
      SandboxPort | SandboxPort[] | { ports?: SandboxPort[] }
    >('POST', `${this.sandboxPath}/ports/add`, { body });
    return extractPort(response, port);
  }

  async removePort(port: number): Promise<void> {
    await this.rest.request('POST', `${this.sandboxPath}/ports/remove`, {
      body: { port },
      responseType: 'void',
    });
  }

  async updatePorts(ports: Array<AddPortRequest | number>): Promise<SandboxPort[]> {
    const response = await this.rest.request<SandboxPort[] | { ports?: SandboxPort[] }>(
      'PUT',
      `${this.sandboxPath}/ports`,
      {
        body: { ports: ports.map((port) => (typeof port === 'number' ? { port } : port)) },
      },
    );
    return Array.isArray(response) ? response : (response.ports ?? []);
  }

  async createSnapshot(options: { name?: string } = {}): Promise<Snapshot> {
    return this.rest.request<Snapshot>('POST', `${this.sandboxPath}/snapshot`, {
      body: options.name ? { labels: { name: options.name } } : {},
    });
  }

  beginCreateSnapshot(options: { name?: string } = {}): OperationPoller<Snapshot> {
    let snapshot: Snapshot | undefined;
    return new OperationPoller(async () => {
      snapshot ??= await this.createSnapshot(options);
      return { done: true, status: snapshot.state, result: snapshot };
    });
  }

  async getStats(): Promise<SandboxStats> {
    return this.rest.request<SandboxStats>('GET', `${this.sandboxPath}/stats`);
  }

  async setLifecyclePolicy(policy: LifecyclePolicy): Promise<LifecyclePolicy> {
    return this.rest.request<LifecyclePolicy>('POST', `${this.sandboxPath}/lifecycle`, {
      body: toLifecyclePolicyWire(policy),
    });
  }

  async commit(options: { name?: string } = {}): Promise<DiskImage> {
    const response = await this.rest.request<
      DiskImage | { diskImage?: DiskImage; diskImageId?: string }
    >('POST', `${this.sandboxPath}/commit`, {
      body: options.name ? { labels: { name: options.name } } : {},
    });

    const wrappedImage = (response as { diskImage?: DiskImage }).diskImage;

    if (wrappedImage) {
      return wrappedImage;
    }
    const diskImageId = (response as { diskImageId?: string }).diskImageId;

    if (typeof diskImageId === 'string') {
      return { ...response, id: diskImageId, name: options.name } as DiskImage;
    }
    return response as DiskImage;
  }

  beginCommit(options: { name?: string } = {}): OperationPoller<DiskImage> {
    let image: DiskImage | undefined;
    return statePoller({
      getResource: async () => {
        image ??= await this.commit(options);

        try {
          return await this.getCommittedDiskImage(image.id);
        } catch (error) {
          if (isNotFoundError(error)) {
            return image;
          }
          throw error;
        }
      },
      getState: (resource) => resource.status?.state,
      targetStates: ['Ready', 'Succeeded'],
      failedStates: ['Failed'],
      transform: (resource) => resource,
    });
  }

  private async getCommittedDiskImage(imageId: string): Promise<DiskImage> {
    return this.rest.request<DiskImage>(
      'GET',
      `${this.groupPath}/diskimages/${pathSegment(imageId, 'imageId')}`,
    );
  }

  async addVolumeMount(volumeMount: AddVolumeMountRequest): Promise<void> {
    await this.rest.request('POST', `${this.sandboxPath}/volumes/add`, {
      body: volumeMount,
      responseType: 'void',
    });
  }

  async setEgressPolicy(policy: EgressPolicy): Promise<EgressPolicy> {
    await this.ensureRunning();
    return this.rest.request<EgressPolicy>('POST', `${this.sandboxPath}/egresspolicy`, {
      body: policy,
    });
  }

  async getEgressPolicy(): Promise<EgressPolicy> {
    const sandbox = await this.get();
    return sandbox.egressPolicy ?? { defaultAction: 'Allow' };
  }

  async setEgressDefault(action: 'Allow' | 'Deny' = 'Deny'): Promise<EgressPolicy> {
    const policy = await this.getEgressPolicy();
    return this.setEgressPolicy({ ...policy, defaultAction: action });
  }

  async addEgressHostRule(
    pattern: string,
    options: { action?: 'Allow' | 'Deny' } = {},
  ): Promise<EgressPolicy> {
    const policy = await this.getEgressPolicy();
    return this.setEgressPolicy({
      ...policy,
      hostRules: [...(policy.hostRules ?? []), { pattern, action: options.action ?? 'Allow' }],
    });
  }

  async addEgressTransformRule(
    host: string,
    headers: EgressHeader[],
    options: { name?: string; path?: string; methods?: string[] } = {},
  ): Promise<EgressPolicy> {
    const policy = await this.getEgressPolicy();
    return this.setEgressPolicy({
      ...policy,
      rules: [
        ...(policy.rules ?? []),
        {
          name: options.name,
          match: { host, path: options.path, methods: options.methods },
          action: { type: 'Transform', headers },
        },
      ],
    });
  }

  async getEgressDecisions(): Promise<EgressDecisions> {
    return this.rest.request<EgressDecisions>('GET', `${this.sandboxPath}/egress-decisions`);
  }
}

function toLifecyclePolicyWire(policy: LifecyclePolicy): Record<string, unknown> {
  const wire: Record<string, unknown> = { ...policy };

  if (policy.autoSuspend) {
    wire.autoSuspendPolicy = policy.autoSuspend;
    delete wire.autoSuspend;
  }

  if (policy.autoDelete) {
    wire.autoDeletePolicy = policy.autoDelete;
    delete wire.autoDelete;
  }
  return wire;
}

function extractPort(
  response: SandboxPort | SandboxPort[] | { ports?: SandboxPort[] },
  requestedPort: number,
): SandboxPort {
  const ports = Array.isArray(response)
    ? response
    : 'ports' in response && Array.isArray(response.ports)
      ? response.ports
      : undefined;

  if (!ports) {
    return response as SandboxPort;
  }
  return (
    ports.find((port) => port.port === requestedPort) ?? ports.at(-1) ?? { port: requestedPort }
  );
}
