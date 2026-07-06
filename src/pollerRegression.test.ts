import { describe, expect, it, vi } from 'vitest';

import { endpointForRegion } from './constants.js';
import { SandboxClient } from './sandboxClient.js';
import { SandboxGroupClient } from './sandboxGroupClient.js';
import type { AccessToken, GetTokenOptions, TokenCredential } from './types.js';

const credential: TokenCredential = {
  getToken(_scopes: string | string[], _options?: GetTokenOptions): Promise<AccessToken> {
    return Promise.resolve({ token: 'token', expiresOnTimestamp: Date.now() + 60_000 });
  },
};

describe('poller regressions', () => {
  it('retries transient 404s while waiting for a created sandbox to become visible', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'sandbox-1', state: 'Creating' }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'not found' } }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'sandbox-1', state: 'Running' }));
    const client = new SandboxGroupClient(endpointForRegion('eastus2'), credential, {
      subscriptionId: 'sub',
      resourceGroup: 'rg',
      sandboxGroup: 'group',
      fetch: fetchMock,
    });

    const poller = client.beginCreateSandbox({ disk: 'ubuntu' });

    expect(await poller.poll()).toMatchObject({ done: false, status: 'Creating' });
    expect(await poller.poll()).toMatchObject({ done: true, status: 'Running' });
  });

  it('retries transient 404s while waiting for a created disk image to become visible', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'image-1', status: { state: 'Creating' } }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'not found' } }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'image-1', status: { state: 'Ready' } }));
    const client = new SandboxGroupClient(endpointForRegion('eastus2'), credential, {
      subscriptionId: 'sub',
      resourceGroup: 'rg',
      sandboxGroup: 'group',
      fetch: fetchMock,
    });

    const poller = client.beginCreateDiskImage('ubuntu:latest');

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
    const sandbox = new SandboxClient(endpointForRegion('eastus2'), credential, {
      subscriptionId: 'sub',
      resourceGroup: 'rg',
      sandboxGroup: 'group',
      sandboxId: 'sandbox-1',
      fetch: fetchMock,
    });

    const poller = sandbox.beginCommit();

    expect(await poller.poll()).toMatchObject({ done: false, status: 'Creating' });
    expect(await poller.poll()).toMatchObject({ done: false, status: 'Creating' });
    expect(await poller.poll()).toMatchObject({ done: true, status: 'Ready' });
  });
});

describe('lifecycle policy serialization', () => {
  it('converts public lifecycle field names to the service wire names', async () => {
    let requestBody: unknown;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      requestBody = JSON.parse(await new Response(init?.body).text());
      return jsonResponse({ autoSuspendPolicy: { enabled: true, interval: 60, mode: 'Memory' } });
    });
    const sandbox = new SandboxClient(endpointForRegion('eastus2'), credential, {
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
