import { describe, expect, it, vi } from 'vitest';

import { CommandFailedError } from './errors.js';
import { PagedIterable } from './pagination.js';
import { OperationPoller } from './poller.js';
import { SandboxClient } from './sandboxClient.js';
import { SandboxGroupClient } from './sandboxGroupClient.js';
import type { AccessToken, GetTokenOptions, TokenCredential } from './types.js';

const credential: TokenCredential = {
  getToken(_scopes: string | string[], _options?: GetTokenOptions): Promise<AccessToken> {
    return Promise.resolve({ token: 'token', expiresOnTimestamp: Date.now() + 60_000 });
  },
};

describe('poller regressions', () => {
  it('is awaitable, eager, and memoizes completion', async () => {
    let polls = 0;
    const poller = new OperationPoller<string>(async () => {
      polls += 1;
      return polls === 1
        ? { done: false, status: 'Creating' }
        : { done: true, status: 'Ready', result: 'ready' };
    }).start();

    const first = poller.poll();
    const second = poller.poll();

    expect(await first).toEqual({ done: false, status: 'Creating' });
    expect(await second).toEqual({ done: false, status: 'Creating' });
    expect(await Promise.all([poller.pollUntilDone({ intervalInMs: 0 }), poller])).toEqual([
      'ready',
      'ready',
    ]);
    expect(polls).toBe(2);
  });

  it('surfaces errors from eager pollers when awaited', async () => {
    const error = new Error('boom');
    const poller = new OperationPoller<string>(async () => {
      throw error;
    }).start();

    await expect(poller).rejects.toBe(error);
  });

  it('retries transient 404s while waiting for a created sandbox to become visible', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'sandbox-1', state: 'Creating' }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'not found' } }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'sandbox-1', state: 'Running' }));
    const client = new SandboxGroupClient({
      region: 'eastus2',
      credential,
      subscriptionId: 'sub',
      resourceGroup: 'rg',
      sandboxGroup: 'group',
      fetch: fetchMock,
    });

    const poller = client.createSandbox({ disk: 'ubuntu' });

    expect(await poller.poll()).toMatchObject({ done: false, status: 'Creating' });
    expect(await poller.poll()).toMatchObject({ done: true, status: 'Running' });
  });

  it('retries transient 404s while waiting for a created disk image to become visible', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'image-1', status: { state: 'Creating' } }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'not found' } }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'image-1', status: { state: 'Ready' } }));
    const client = new SandboxGroupClient({
      region: 'eastus2',
      credential,
      subscriptionId: 'sub',
      resourceGroup: 'rg',
      sandboxGroup: 'group',
      fetch: fetchMock,
    });

    const poller = client.createDiskImage('ubuntu:latest');

    expect(await poller.poll()).toMatchObject({ done: false, status: 'Creating' });
    expect(await poller.poll()).toMatchObject({ done: true, status: 'Ready' });
  });

  it('polls committed disk images until they are ready', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ diskImage: { id: 'image-1', status: { state: 'Creating' } } }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'not found' } }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'image-1', status: { state: 'Creating' } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'image-1', status: { state: 'Ready' } }));
    const sandbox = new SandboxClient({
      region: 'eastus2',
      credential,
      subscriptionId: 'sub',
      resourceGroup: 'rg',
      sandboxGroup: 'group',
      sandboxId: 'sandbox-1',
      fetch: fetchMock,
    });

    const poller = sandbox.commit();

    expect(await poller.poll()).toMatchObject({ done: false, status: 'Creating' });
    expect(await poller.poll()).toMatchObject({ done: false, status: 'Creating' });
    expect(await poller.poll()).toMatchObject({ done: true, status: 'Ready' });
  });
});

describe('paged results', () => {
  it('can be materialized to an array', async () => {
    const items = new PagedIterable(async function* () {
      yield 'a';
      yield 'b';
    });

    expect(await items.toArray()).toEqual(['a', 'b']);
    expect(await items.toArray()).toEqual(['a', 'b']);
  });
});

describe('client construction helpers', () => {
  it('rejects region and endpoint together', () => {
    expect(
      () =>
        new SandboxGroupClient({
          region: 'eastus2',
          endpoint: 'https://management.eastus2.azuredevcompute.io',
          credential,
          subscriptionId: 'sub',
          resourceGroup: 'rg',
          sandboxGroup: 'group',
        }),
    ).toThrow('Use either endpoint or region, not both.');
  });

  it('reports missing fromEnv variables', () => {
    const processEnv = (
      globalThis as unknown as { process: { env: Record<string, string | undefined> } }
    ).process.env;
    const previous = processEnv.AZURE_SANDBOX_GROUP;
    delete processEnv.AZURE_SANDBOX_GROUP;

    try {
      expect(() =>
        SandboxGroupClient.fromEnv({
          credential,
          subscriptionId: 'sub',
          resourceGroup: 'rg',
        }),
      ).toThrow('Missing required environment variable: AZURE_SANDBOX_GROUP');
    } finally {
      processEnv.AZURE_SANDBOX_GROUP = previous;
    }
  });

  it('does not combine endpoint with AZURE_REGION in fromEnv', () => {
    const processEnv = (
      globalThis as unknown as { process: { env: Record<string, string | undefined> } }
    ).process.env;
    const previous = processEnv.AZURE_REGION;
    processEnv.AZURE_REGION = 'eastus2';

    try {
      expect(() =>
        SandboxGroupClient.fromEnv({
          credential,
          endpoint: 'https://management.azuredevcompute.io',
          subscriptionId: 'sub',
          resourceGroup: 'rg',
          sandboxGroup: 'group',
        }),
      ).not.toThrow();
    } finally {
      processEnv.AZURE_REGION = previous;
    }
  });
});

describe('exec ergonomics', () => {
  it('normalizes missing command result fields', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
    const sandbox = new SandboxClient({
      region: 'eastus2',
      credential,
      subscriptionId: 'sub',
      resourceGroup: 'rg',
      sandboxGroup: 'group',
      sandboxId: 'sandbox-1',
      fetch: fetchMock,
    });

    await expect(sandbox.exec('true')).resolves.toEqual({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('throws when check is enabled and the command exits non-zero', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ stderr: 'bad command', exitCode: 127 }));
    const sandbox = new SandboxClient({
      region: 'eastus2',
      credential,
      subscriptionId: 'sub',
      resourceGroup: 'rg',
      sandboxGroup: 'group',
      sandboxId: 'sandbox-1',
      fetch: fetchMock,
    });

    await expect(sandbox.exec('bad', { check: true })).rejects.toBeInstanceOf(CommandFailedError);
  });
});

describe('lifecycle policy serialization', () => {
  it('converts public lifecycle field names to the service wire names', async () => {
    let requestBody: unknown;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      requestBody = JSON.parse(await new Response(init?.body).text());
      return jsonResponse({ autoSuspendPolicy: { enabled: true, interval: 60, mode: 'Memory' } });
    });
    const sandbox = new SandboxClient({
      region: 'eastus2',
      credential,
      subscriptionId: 'sub',
      resourceGroup: 'rg',
      sandboxGroup: 'group',
      sandboxId: 'sandbox-1',
      fetch: fetchMock,
    });

    await sandbox.setLifecyclePolicy({
      autoSuspend: { enabled: true, interval: 60, mode: 'Memory' },
      autoDelete: { enabled: true, deleteIntervalSeconds: 600 },
    });

    expect(requestBody).toEqual({
      autoSuspendPolicy: { enabled: true, interval: 60, mode: 'Memory' },
      autoDeletePolicy: { enabled: true, deleteIntervalSeconds: 600 },
    });
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}
