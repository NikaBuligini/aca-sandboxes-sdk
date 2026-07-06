import { HarnessCapabilityUnsupportedError } from '@ai-sdk/harness';
import { describe, expect, it, vi } from 'vitest';

import { AcaNetworkSandboxSession, createAcaSandbox, toAcaEgressPolicy } from './index.js';
import { createAcaSandboxProcess } from './process.js';
import { AcaSandboxSession } from './session.js';
import { SandboxClient } from '../sandboxClient.js';
import { SandboxGroupClient } from '../sandboxGroupClient.js';
import type { AccessToken, GetTokenOptions, TokenCredential } from '../types.js';

const credential: TokenCredential = {
  getToken(_scopes: string | string[], _options?: GetTokenOptions): Promise<AccessToken> {
    return Promise.resolve({ token: 'token', expiresOnTimestamp: Date.now() + 60_000 });
  },
};

describe('AI SDK sandbox provider', () => {
  it('creates sessions lazily and wires labels, ports, and onFirstCreate', async () => {
    const calls: CapturedRequest[] = [];
    const fetchMock = routedFetch(calls, async (request) => {
      if (request.method === 'PUT' && request.url.includes('/sandboxes?')) {
        return jsonResponse({ id: 'sandbox-1', state: 'Creating' });
      }

      if (request.method === 'GET' && request.url.includes('/sandboxes/sandbox-1?')) {
        return jsonResponse({
          id: 'sandbox-1',
          state: 'Running',
          ports: [{ port: 3000, url: 'https://sandbox.example.com' }],
        });
      }

      if (request.method === 'POST' && request.url.includes('/executeShellCommand?')) {
        return jsonResponse({ stdout: '/workspace\n', stderr: '', exitCode: 0 });
      }
      throw new Error(`Unexpected ${request.method} ${request.url}`);
    });
    const provider = createAcaSandbox({
      client: groupClient(fetchMock),
      ports: [3000],
    });
    let bootstrapped = false;
    const session = await provider.createSession({
      sessionId: 'session-1',
      identity: 'ignored-for-simple-fallback',
      onFirstCreate: async (restricted) => {
        bootstrapped = true;
        expect(restricted.description).toContain('sandbox-1');
      },
    });

    expect(bootstrapped).toBe(true);
    expect(session.id).toBe('sandbox-1');
    expect(session.defaultWorkingDirectory).toBe('/workspace');
    expect(session.ports).toEqual([3000]);
    await expect(session.getPortUrl({ port: 3000, protocol: 'ws' })).resolves.toBe(
      'wss://sandbox.example.com/',
    );

    const createBody = calls.find((call) => call.method === 'PUT')?.body as {
      labels?: Record<string, string>;
      ports?: Array<{ port: number; auth?: unknown }>;
    };
    expect(createBody.labels).toMatchObject({ 'ai-sdk-session': 'session-1' });
    expect(createBody.ports).toEqual([{ port: 3000, auth: { anonymous: true } }]);
  });

  it('resumes labeled sandboxes and ensures they are running', async () => {
    const calls: CapturedRequest[] = [];
    let getSandboxCalls = 0;
    const fetchMock = routedFetch(calls, async (request) => {
      if (request.method === 'GET' && request.url.includes('/sandboxes?')) {
        return jsonResponse({ value: [{ id: 'sandbox-1', state: 'Suspended' }] });
      }

      if (request.method === 'GET' && request.url.includes('/sandboxes/sandbox-1?')) {
        getSandboxCalls += 1;
        return jsonResponse({
          id: 'sandbox-1',
          state: getSandboxCalls === 1 ? 'Suspended' : 'Running',
          ports: [],
        });
      }

      if (request.method === 'POST' && request.url.includes('/resume?')) {
        return new Response(null, { status: 204 });
      }

      if (request.method === 'POST' && request.url.includes('/executeShellCommand?')) {
        return jsonResponse({ stdout: '/workspace\n', stderr: '', exitCode: 0 });
      }
      throw new Error(`Unexpected ${request.method} ${request.url}`);
    });
    const provider = createAcaSandbox({ client: groupClient(fetchMock) });
    const session = await provider.resumeSession?.({ sessionId: 'session-1' });

    expect(session?.id).toBe('sandbox-1');
    expect(
      new URL(calls.find((call) => call.url.includes('/sandboxes?'))?.url ?? '').searchParams.get(
        'labels',
      ),
    ).toBe('ai-sdk-session=session-1');
    expect(calls.some((call) => call.url.includes('/resume?'))).toBe(true);
  });

  it('returns null for missing files', async () => {
    const fetchMock = routedFetch([], async (request) => {
      if (request.method === 'GET' && request.url.includes('/sandboxes/sandbox-1?')) {
        return jsonResponse({ id: 'sandbox-1', state: 'Running' });
      }

      if (request.method === 'GET' && request.url.includes('/files?')) {
        return jsonResponse({ error: { message: 'not found' } }, { status: 404 });
      }
      throw new Error(`Unexpected ${request.method} ${request.url}`);
    });
    const session = new AcaSandboxSession(sandboxClient(fetchMock), '/workspace');

    await expect(session.readBinaryFile({ path: 'missing.txt' })).resolves.toBeNull();
  });

  it('resolves exposed port URLs and rejects missing ports', async () => {
    const fetchMock = routedFetch([], async (request) => {
      if (request.method === 'GET' && request.url.includes('/sandboxes/sandbox-1?')) {
        return jsonResponse({
          id: 'sandbox-1',
          state: 'Running',
          ports: [{ port: 3000, url: 'https://sandbox.example.com' }],
        });
      }
      throw new Error(`Unexpected ${request.method} ${request.url}`);
    });
    const session = new AcaNetworkSandboxSession({
      sandbox: sandboxClient(fetchMock),
      ownsLifecycle: false,
      defaultWorkingDirectory: '/workspace',
    });

    await expect(session.getPortUrl({ port: 3000, protocol: 'http' })).resolves.toBe(
      'https://sandbox.example.com/',
    );
    await expect(session.getPortUrl({ port: 4000 })).rejects.toBeInstanceOf(
      HarnessCapabilityUnsupportedError,
    );
  });
});

describe('AI SDK network policy mapping', () => {
  it('maps host allow-lists to ACA egress policy', () => {
    expect(toAcaEgressPolicy({ mode: 'allow-all' })).toEqual({ defaultAction: 'Allow' });
    expect(toAcaEgressPolicy({ mode: 'deny-all' })).toEqual({ defaultAction: 'Deny' });
    expect(
      toAcaEgressPolicy({ mode: 'custom', allowedHosts: ['api.example.com', '*.example.org'] }),
    ).toEqual({
      defaultAction: 'Deny',
      hostRules: [
        { pattern: 'api.example.com', action: 'Allow' },
        { pattern: '*.example.org', action: 'Allow' },
      ],
    });
  });

  it('rejects CIDR network policies', () => {
    expect(() => toAcaEgressPolicy({ mode: 'custom', allowedCIDRs: ['10.0.0.0/24'] })).toThrow(
      HarnessCapabilityUnsupportedError,
    );
  });
});

describe('AI SDK spawn emulation', () => {
  it('streams output and waits for an emulated process', async () => {
    const exec = vi.fn<
      (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
    >(async (command) => {
      if (command.includes('nohup setsid')) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (command.includes('tail -c') && command.includes('/stdout')) {
        return { stdout: 'hello\n', stderr: '', exitCode: 0 };
      }

      if (command.includes('tail -c') && command.includes('/stderr')) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (command.includes('kill -0')) {
        return { stdout: '0', stderr: '', exitCode: 0 };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const process = await createAcaSandboxProcess({ exec } as unknown as SandboxClient, {
      command: 'printf hello',
    });
    const stdout = readStream(process.stdout);

    await expect(process.wait()).resolves.toEqual({ exitCode: 0 });
    await expect(stdout).resolves.toBe('hello\n');
  });
});

type CapturedRequest = {
  method: string;
  url: string;
  body?: unknown;
};

function groupClient(fetchMock: typeof fetch): SandboxGroupClient {
  return new SandboxGroupClient({
    region: 'eastus2',
    credential,
    subscriptionId: 'sub',
    resourceGroup: 'rg',
    sandboxGroup: 'group',
    fetch: fetchMock,
  });
}

function sandboxClient(fetchMock: typeof fetch): SandboxClient {
  return new SandboxClient({
    region: 'eastus2',
    credential,
    subscriptionId: 'sub',
    resourceGroup: 'rg',
    sandboxGroup: 'group',
    sandboxId: 'sandbox-1',
    fetch: fetchMock,
  });
}

function routedFetch(
  calls: CapturedRequest[],
  handler: (request: Request) => Promise<Response>,
): typeof fetch {
  return vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
    const body =
      request.method === 'GET' || request.method === 'HEAD' ? undefined : await parseBody(request);
    calls.push({ method: request.method, url: request.url, body });
    return handler(request);
  });
}

async function parseBody(request: Request): Promise<unknown> {
  const text = await request.clone().text();

  if (!text) {
    return undefined;
  }
  return JSON.parse(text);
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      chunks.push(value);
    }
  }
  return new TextDecoder().decode(concat(chunks));
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
