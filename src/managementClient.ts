import { ARM_BASE, ARM_SCOPE, DEFAULT_API_VERSION } from './constants.js';
import { RestClient } from './http.js';
import { PagedIterable, listPaged } from './pagination.js';
import { OperationPoller } from './poller.js';
import type {
  CreateSandboxGroupOptions,
  SandboxGroup,
  SandboxGroupManagementClientFromEnvOptions,
  SandboxGroupManagementClientOptions,
} from './types.js';
import { pathSegment, validatePathSegment } from './util.js';

export class SandboxGroupManagementClient {
  readonly subscriptionId: string;
  readonly resourceGroup: string;

  private readonly rest: RestClient;

  constructor(options: SandboxGroupManagementClientOptions) {
    this.subscriptionId = options.subscriptionId;
    this.resourceGroup = validatePathSegment(options.resourceGroup, 'resourceGroup');
    this.rest = new RestClient({
      endpoint: ARM_BASE,
      credential: options.credential,
      scope: ARM_SCOPE,
      apiVersion: options.apiVersion ?? DEFAULT_API_VERSION,
      fetch: options.fetch,
    });
  }

  static fromEnv(
    options: SandboxGroupManagementClientFromEnvOptions,
  ): SandboxGroupManagementClient {
    return new SandboxGroupManagementClient({
      ...options,
      subscriptionId: options.subscriptionId ?? requiredEnv('AZURE_SUBSCRIPTION_ID'),
      resourceGroup: options.resourceGroup ?? requiredEnv('AZURE_RESOURCE_GROUP'),
    });
  }

  get groupBasePath(): string {
    return `/subscriptions/${encodeURIComponent(this.subscriptionId)}/resourceGroups/${pathSegment(this.resourceGroup, 'resourceGroup')}/providers/Microsoft.App/sandboxGroups`;
  }

  listGroups(): PagedIterable<SandboxGroup> {
    return new PagedIterable(() =>
      listPaged<SandboxGroup>({ client: this.rest, path: this.groupBasePath }),
    );
  }

  async getGroup(name: string): Promise<SandboxGroup> {
    validatePathSegment(name, 'sandboxGroup');
    return this.rest.request<SandboxGroup>(
      'GET',
      `${this.groupBasePath}/${pathSegment(name, 'sandboxGroup')}`,
    );
  }

  createGroup(
    name: string,
    location: string,
    options: CreateSandboxGroupOptions = {},
  ): OperationPoller<SandboxGroup> {
    let operationUrl: string | undefined;
    let started = false;
    let completed: SandboxGroup | undefined;

    return new OperationPoller(async () => {
      if (!started) {
        started = true;
        const initial = await this.rest.requestRaw<SandboxGroup>(
          'PUT',
          `${this.groupBasePath}/${pathSegment(name, 'sandboxGroup')}`,
          {
            body: sandboxGroupBody(location, options),
            allowedStatusCodes: [202],
          },
        );
        operationUrl =
          initial.headers.get('Azure-AsyncOperation') ??
          initial.headers.get('Location') ??
          undefined;

        if (!operationUrl || initial.status < 202) {
          completed = initial.body;
          return { done: true, status: 'Succeeded', result: completed };
        }
      }

      if (!operationUrl) {
        completed ??= await this.getGroup(name);
        return { done: true, status: 'Succeeded', result: completed };
      }

      const statusResponse = await this.rest.request<Record<string, unknown>>('GET', operationUrl, {
        addApiVersion: false,
      });
      const status = typeof statusResponse.status === 'string' ? statusResponse.status : undefined;

      if (!status || ['Succeeded', 'Canceled'].includes(status)) {
        completed = await this.getGroup(name);
        return { done: true, status: status ?? 'Succeeded', result: completed };
      }

      if (status === 'Failed') {
        throw new Error(`Sandbox group operation failed: ${JSON.stringify(statusResponse)}`);
      }
      return { done: false, status };
    }).start();
  }

  deleteGroup(name: string): OperationPoller<void> {
    let operationUrl: string | undefined;
    let started = false;

    return new OperationPoller(async () => {
      if (!started) {
        started = true;
        const initial = await this.rest.requestRaw(
          'DELETE',
          `${this.groupBasePath}/${pathSegment(name, 'sandboxGroup')}`,
          {
            responseType: 'void',
            allowedStatusCodes: [202],
          },
        );
        operationUrl =
          initial.headers.get('Azure-AsyncOperation') ??
          initial.headers.get('Location') ??
          undefined;

        if (!operationUrl || initial.status < 202) {
          return { done: true, status: 'Succeeded', result: undefined };
        }
      }

      if (!operationUrl) {
        return { done: true, status: 'Succeeded', result: undefined };
      }

      const statusResponse = await this.rest.request<Record<string, unknown>>('GET', operationUrl, {
        addApiVersion: false,
      });
      const status = typeof statusResponse.status === 'string' ? statusResponse.status : undefined;

      if (!status || ['Succeeded', 'Canceled'].includes(status)) {
        return { done: true, status: status ?? 'Succeeded', result: undefined };
      }

      if (status === 'Failed') {
        throw new Error(`Sandbox group delete failed: ${JSON.stringify(statusResponse)}`);
      }
      return { done: false, status };
    }).start();
  }

  patchGroupIdentity(
    name: string,
    identity: Record<string, unknown>,
  ): OperationPoller<SandboxGroup> {
    let operationUrl: string | undefined;
    let started = false;
    return new OperationPoller(async () => {
      if (!started) {
        started = true;
        const initial = await this.rest.requestRaw<SandboxGroup>(
          'PATCH',
          `${this.groupBasePath}/${pathSegment(name, 'sandboxGroup')}`,
          {
            body: { identity },
            allowedStatusCodes: [202],
          },
        );
        operationUrl =
          initial.headers.get('Azure-AsyncOperation') ??
          initial.headers.get('Location') ??
          undefined;

        if (!operationUrl || initial.status < 202) {
          return { done: true, status: 'Succeeded', result: initial.body };
        }
      }

      if (!operationUrl) {
        return { done: true, status: 'Succeeded', result: await this.getGroup(name) };
      }
      const statusResponse = await this.rest.request<Record<string, unknown>>('GET', operationUrl, {
        addApiVersion: false,
      });
      const status = typeof statusResponse.status === 'string' ? statusResponse.status : undefined;

      if (!status || ['Succeeded', 'Canceled'].includes(status)) {
        return { done: true, status: status ?? 'Succeeded', result: await this.getGroup(name) };
      }

      if (status === 'Failed') {
        throw new Error(`Sandbox group identity patch failed: ${JSON.stringify(statusResponse)}`);
      }
      return { done: false, status };
    }).start();
  }

  async createOrUpdateVnetConnection(
    sandboxGroupName: string,
    connectionName: string,
    subnetId: string,
    options: { location?: string } = {},
  ): Promise<Record<string, unknown>> {
    validatePathSegment(sandboxGroupName, 'sandboxGroup');
    validatePathSegment(connectionName, 'connectionName');

    if (!subnetId) {
      throw new Error('subnetId is required.');
    }

    const location = options.location ?? (await this.getGroup(sandboxGroupName)).location;

    if (!location) {
      throw new Error('location is required when sandbox group location cannot be resolved.');
    }

    return this.rest.request<Record<string, unknown>>(
      'PUT',
      `${this.groupBasePath}/${pathSegment(sandboxGroupName, 'sandboxGroup')}/vnetConnections/${pathSegment(connectionName, 'connectionName')}`,
      { body: { location, properties: { subnetId } } },
    );
  }

  async deleteVnetConnection(sandboxGroupName: string, connectionName: string): Promise<void> {
    validatePathSegment(sandboxGroupName, 'sandboxGroup');
    validatePathSegment(connectionName, 'connectionName');
    await this.rest.request(
      'DELETE',
      `${this.groupBasePath}/${pathSegment(sandboxGroupName, 'sandboxGroup')}/vnetConnections/${pathSegment(connectionName, 'connectionName')}`,
      { responseType: 'void', allowedStatusCodes: [202] },
    );
  }
}

function requiredEnv(name: string): string {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sandboxGroupBody(
  location: string,
  options: CreateSandboxGroupOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = { location };

  if (options.identity) body.identity = options.identity;

  if (options.tags) body.tags = options.tags;

  if (options.properties) body.properties = options.properties;
  return body;
}
