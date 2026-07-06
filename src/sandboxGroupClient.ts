import { DATA_PLANE_BASE, DATA_PLANE_SCOPE, DEFAULT_API_VERSION } from './constants.js';
import { isNotFoundError } from './errors.js';
import { RestClient } from './http.js';
import { listPaged } from './pagination.js';
import { OperationPoller, statePoller } from './poller.js';
import { SandboxClient } from './sandboxClient.js';
import type {
  CreateDiskImageOptions,
  CreateSandboxOptions,
  CreateVolumeOptions,
  DiskImage,
  ListSandboxesOptions,
  PublicDiskImage,
  Sandbox,
  SandboxGroupClientOptions,
  SecretMetadata,
  SecretValuePeek,
  Snapshot,
  TokenCredential,
  Volume,
} from './types.js';
import { labelsToSelector, pathSegment, validatePathSegment } from './util.js';

export class SandboxGroupClient {
  readonly subscriptionId: string;
  readonly resourceGroup: string;
  readonly sandboxGroup: string;

  private readonly rest: RestClient;

  constructor(endpoint: string, credential: TokenCredential, options: SandboxGroupClientOptions) {
    this.subscriptionId = options.subscriptionId;
    this.resourceGroup = validatePathSegment(options.resourceGroup, 'resourceGroup');
    this.sandboxGroup = validatePathSegment(options.sandboxGroup, 'sandboxGroup');
    this.rest = new RestClient({
      endpoint: endpoint || DATA_PLANE_BASE,
      credential,
      scope: options.audience ?? DATA_PLANE_SCOPE,
      apiVersion: options.apiVersion ?? DEFAULT_API_VERSION,
      fetch: options.fetch,
    });
  }

  get groupPath(): string {
    return `/subscriptions/${encodeURIComponent(this.subscriptionId)}/resourceGroups/${pathSegment(this.resourceGroup, 'resourceGroup')}/sandboxGroups/${pathSegment(this.sandboxGroup, 'sandboxGroup')}`;
  }

  getSandboxClient(sandboxId: string): SandboxClient {
    validatePathSegment(sandboxId, 'sandboxId');
    return new SandboxClient(this.rest, {
      subscriptionId: this.subscriptionId,
      resourceGroup: this.resourceGroup,
      sandboxGroup: this.sandboxGroup,
      sandboxId,
    });
  }

  listSandboxes(options: ListSandboxesOptions = {}): AsyncIterable<Sandbox> {
    return listPaged<Sandbox>({
      client: this.rest,
      path: `${this.groupPath}/sandboxes`,
      params: { labels: labelsToSelector(options.labels) },
    });
  }

  async getSandbox(sandboxId: string): Promise<Sandbox> {
    validatePathSegment(sandboxId, 'sandboxId');
    return this.rest.request<Sandbox>(
      'GET',
      `${this.groupPath}/sandboxes/${pathSegment(sandboxId, 'sandboxId')}`,
    );
  }

  beginCreateSandbox(options: CreateSandboxOptions = {}): OperationPoller<SandboxClient> {
    let created: Sandbox | undefined;
    let client: SandboxClient | undefined;

    return statePoller({
      getResource: async () => {
        if (!created) {
          created = await this.createSandboxResource(options);
          client = this.getSandboxClient(created.id);
        }

        try {
          return await this.getSandbox(created.id);
        } catch (error) {
          if (isNotFoundError(error)) {
            return created;
          }
          throw error;
        }
      },
      getState: (sandbox) => sandbox.state,
      targetStates: ['Running'],
      failedStates: ['Failed', 'Deleting'],
      transform: () => client as SandboxClient,
    });
  }

  async createSandbox(options: CreateSandboxOptions = {}): Promise<SandboxClient> {
    return this.beginCreateSandbox(options).pollUntilDone();
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    validatePathSegment(sandboxId, 'sandboxId');
    await this.rest.request(
      'DELETE',
      `${this.groupPath}/sandboxes/${pathSegment(sandboxId, 'sandboxId')}`,
      {
        responseType: 'void',
        allowedStatusCodes: [202],
      },
    );
  }

  beginDeleteSandbox(sandboxId: string): OperationPoller<void> {
    let started = false;
    return new OperationPoller(async () => {
      if (!started) {
        started = true;
        await this.deleteSandbox(sandboxId);
      }

      try {
        await this.getSandbox(sandboxId);
        return { done: false, status: 'Deleting' };
      } catch (error) {
        if (isNotFoundError(error)) {
          return { done: true, status: 'Deleted', result: undefined };
        }
        throw error;
      }
    });
  }

  listDiskImages(): AsyncIterable<DiskImage> {
    return listPaged<DiskImage>({ client: this.rest, path: `${this.groupPath}/diskimages` });
  }

  listPublicDiskImages(): AsyncIterable<PublicDiskImage> {
    return listPaged<PublicDiskImage>({
      client: this.rest,
      path: `${this.groupPath}/diskimages/public`,
    });
  }

  async getDiskImage(imageId: string): Promise<DiskImage> {
    validatePathSegment(imageId, 'imageId');
    return this.rest.request<DiskImage>(
      'GET',
      `${this.groupPath}/diskimages/${pathSegment(imageId, 'imageId')}`,
    );
  }

  async getPublicDiskImage(imageName: string): Promise<PublicDiskImage> {
    validatePathSegment(imageName, 'imageName');
    return this.rest.request<PublicDiskImage>(
      'GET',
      `${this.groupPath}/diskimages/public/${pathSegment(imageName, 'imageName')}`,
    );
  }

  async createDiskImage(
    baseImage: string,
    options: CreateDiskImageOptions = {},
  ): Promise<DiskImage> {
    const body: Record<string, unknown> = { image: { base: baseImage } };

    if (options.entrypoint) {
      (body.image as Record<string, unknown>).entrypoint = options.entrypoint;
    }

    if (options.cmd) {
      (body.image as Record<string, unknown>).cmd = options.cmd;
    }

    if (options.name) {
      body.labels = { name: options.name };
    }

    if (options.registryCredentials) {
      body.registryCredentials = options.registryCredentials;
    }

    if (options.managedIdentityResourceId) {
      body.managedIdentityResourceId = options.managedIdentityResourceId;
    }
    return this.rest.request<DiskImage>('PUT', `${this.groupPath}/diskimages`, { body });
  }

  beginCreateDiskImage(
    baseImage: string,
    options: CreateDiskImageOptions = {},
  ): OperationPoller<DiskImage> {
    let image: DiskImage | undefined;
    return statePoller({
      getResource: async () => {
        image ??= await this.createDiskImage(baseImage, options);

        try {
          return await this.getDiskImage(image.id);
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

  async deleteDiskImage(imageId: string): Promise<void> {
    validatePathSegment(imageId, 'imageId');
    await this.rest.request(
      'DELETE',
      `${this.groupPath}/diskimages/${pathSegment(imageId, 'imageId')}`,
      {
        responseType: 'void',
        allowedStatusCodes: [202],
      },
    );
  }

  listSnapshots(): AsyncIterable<Snapshot> {
    return listPaged<Snapshot>({ client: this.rest, path: `${this.groupPath}/snapshots` });
  }

  async getSnapshot(snapshotId: string): Promise<Snapshot> {
    validatePathSegment(snapshotId, 'snapshotId');
    return this.rest.request<Snapshot>(
      'GET',
      `${this.groupPath}/snapshots/${pathSegment(snapshotId, 'snapshotId')}`,
    );
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    validatePathSegment(snapshotId, 'snapshotId');
    await this.rest.request(
      'DELETE',
      `${this.groupPath}/snapshots/${pathSegment(snapshotId, 'snapshotId')}`,
      {
        responseType: 'void',
        allowedStatusCodes: [202],
      },
    );
  }

  listVolumes(): AsyncIterable<Volume> {
    return listPaged<Volume>({ client: this.rest, path: `${this.groupPath}/volumes` });
  }

  async getVolume(volumeName: string): Promise<Volume> {
    validatePathSegment(volumeName, 'volumeName');
    return this.rest.request<Volume>(
      'GET',
      `${this.groupPath}/volumes/${pathSegment(volumeName, 'volumeName')}`,
    );
  }

  async createVolume(name: string, options: CreateVolumeOptions = {}): Promise<Volume> {
    validatePathSegment(name, 'name');
    const body: Record<string, unknown> = { type: options.type ?? 'AzureBlob' };

    if (options.size) {
      body.size = options.size;
    }

    if (options.labels) {
      body.labels = options.labels;
    }

    if (options.storageContainerResourceId) {
      body.storageContainerResourceId = options.storageContainerResourceId;
    }

    if (options.auth) {
      body.auth = options.auth;
    }
    return this.rest.request<Volume>(
      'PUT',
      `${this.groupPath}/volumes/${pathSegment(name, 'name')}`,
      { body },
    );
  }

  async deleteVolume(volumeName: string): Promise<void> {
    validatePathSegment(volumeName, 'volumeName');
    await this.rest.request(
      'DELETE',
      `${this.groupPath}/volumes/${pathSegment(volumeName, 'volumeName')}`,
      {
        responseType: 'void',
        allowedStatusCodes: [202],
      },
    );
  }

  listSecrets(): AsyncIterable<SecretMetadata> {
    return listPaged<SecretMetadata>({
      client: this.rest,
      path: `${this.groupPath}/secrets`,
      itemKey: 'secrets',
    });
  }

  async upsertSecret(secretId: string, values: Record<string, string>): Promise<SecretValuePeek> {
    validatePathSegment(secretId, 'secretId');
    return this.rest.request<SecretValuePeek>(
      'PUT',
      `${this.groupPath}/secrets/${pathSegment(secretId, 'secretId')}`,
      { body: { values } },
    );
  }

  async deleteSecret(secretId: string): Promise<void> {
    validatePathSegment(secretId, 'secretId');
    await this.rest.request(
      'DELETE',
      `${this.groupPath}/secrets/${pathSegment(secretId, 'secretId')}`,
      { responseType: 'void', allowedStatusCodes: [202] },
    );
  }

  async listSecretKeys(secretId: string): Promise<string[]> {
    validatePathSegment(secretId, 'secretId');
    const response = await this.rest.request<string[] | { keys?: string[] }>(
      'GET',
      `${this.groupPath}/secrets/${pathSegment(secretId, 'secretId')}/keys`,
    );
    return Array.isArray(response) ? response : (response.keys ?? []);
  }

  async peekSecret(secretId: string): Promise<SecretValuePeek> {
    validatePathSegment(secretId, 'secretId');
    return this.rest.request<SecretValuePeek>(
      'POST',
      `${this.groupPath}/secrets/${pathSegment(secretId, 'secretId')}/peek`,
    );
  }

  private async createSandboxResource(options: CreateSandboxOptions): Promise<Sandbox> {
    const body = createSandboxPayload(options);
    return this.rest.request<Sandbox>('PUT', `${this.groupPath}/sandboxes`, { body });
  }
}

function createSandboxPayload(options: CreateSandboxOptions): Record<string, unknown> {
  const explicitSources = [options.preset, options.snapshotId, options.diskId].filter(Boolean);

  if (explicitSources.length > 1) {
    throw new Error(
      'createSandbox accepts exactly one source: preset, snapshotId, diskId, or disk.',
    );
  }

  if (explicitSources.length > 0 && options.disk && options.disk !== 'ubuntu') {
    throw new Error('createSandbox cannot combine disk with preset, snapshotId, or diskId.');
  }

  const body: Record<string, unknown> = {};

  if (options.preset) {
    body.presetSandboxType = options.preset;
  } else if (options.snapshotId) {
    body.sourcesRef = { snapshot: { id: options.snapshotId } };
  } else if (options.diskId) {
    body.sourcesRef = { diskImage: { id: options.diskId } };
  } else {
    body.sourcesRef = { diskImage: { name: options.disk ?? 'ubuntu', isPublic: true } };
  }

  if (options.snapshotId) {
    const unsupported = [
      ['labels', options.labels],
      ['environment', options.environment],
      ['connections', options.connections],
      ['egressPolicy', options.egressPolicy],
      ['volumes', options.volumes],
      ['ports', options.ports],
      ['entrypoint', options.entrypoint],
      ['cmd', options.cmd],
      ['skipEgressProxy', options.skipEgressProxy],
      ['customerVnetConnectionName', options.customerVnetConnectionName],
      ['vmmType', options.vmmType],
    ].filter(([, value]) => value !== undefined);

    if (unsupported.length > 0) {
      throw new Error(
        `Snapshot restore does not support options: ${unsupported.map(([name]) => name).join(', ')}.`,
      );
    }
    return body;
  }

  if (!options.preset) {
    body.resources = {
      cpu: options.cpu ?? '1000m',
      memory: options.memory ?? '2048Mi',
      ...(options.diskSize ? { disk: options.diskSize } : {}),
    };
  }

  body.lifecycle = {
    autoSuspendPolicy: {
      enabled: true,
      interval: options.autoSuspendSeconds ?? 300,
      mode: options.autoSuspendMode ?? 'Memory',
    },
  };

  if (options.labels) body.labels = options.labels;

  if (options.environment) body.environment = options.environment;

  if (options.connections) body.connections = options.connections;

  if (options.egressPolicy) body.egressPolicy = options.egressPolicy;

  if (options.volumes) body.volumes = options.volumes;

  if (options.ports)
    body.ports = options.ports.map((port) => (typeof port === 'number' ? { port } : port));

  if (options.entrypoint) body.entrypoint = options.entrypoint;

  if (options.cmd) body.cmd = options.cmd;

  if (options.skipEgressProxy !== undefined) body.skipEgressProxy = options.skipEgressProxy;

  if (options.customerVnetConnectionName)
    body.customerVnetConnectionName = options.customerVnetConnectionName;

  if (options.vmmType) body.vmmType = options.vmmType;

  return body;
}
