import { describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect, Either, Layer, Stream } from 'effect';

import { AcaSandboxError } from './errors.js';
import {
  AcaSandboxes,
  AzureCredential,
  createSandbox,
  exec,
  listSandboxes,
  pollUntilDone,
  toSdkError,
  withSandbox,
} from './effect.js';
import type { OperationPoller } from './poller.js';
import type { SandboxClient } from './sandboxClient.js';
import type { SandboxGroupClient } from './sandboxGroupClient.js';
import type { TokenCredential } from './types.js';

describe('Effect adapter', () => {
  it.effect('wraps Promise SDK calls', () =>
    Effect.gen(function* () {
      const execMock = vi
        .fn<SandboxClient['exec']>()
        .mockResolvedValue({ stdout: 'hello', stderr: '', exitCode: 0 });
      const sandbox = {
        exec: execMock,
      } as unknown as SandboxClient;

      const result = yield* exec(sandbox, 'echo hello');

      expect(result).toEqual({ stdout: 'hello', stderr: '', exitCode: 0 });
      expect(sandbox.exec).toHaveBeenCalledWith('echo hello', {});
    }),
  );

  it('uses shared tagged SDK errors', () => {
    const error = new AcaSandboxError('missing', 404, { error: { message: 'missing' } });

    expect(toSdkError(error)).toBe(error);
    expect(toSdkError('boom')).toMatchObject({ _tag: 'OperationFailedError', details: 'boom' });
  });

  it.effect('uses native Effect pollers', () =>
    Effect.gen(function* () {
      const pollUntilDoneEffectMock = vi.fn<OperationPoller<string>['pollUntilDoneEffect']>(() =>
        Effect.succeed('ready'),
      );
      const poller = {
        pollUntilDoneEffect: pollUntilDoneEffectMock,
      } as unknown as OperationPoller<string>;

      const result = yield* pollUntilDone(poller);

      expect(result).toBe('ready');
      expect(pollUntilDoneEffectMock).toHaveBeenCalledWith(undefined);
    }),
  );

  it.effect('creates sandboxes through native Effect pollers', () =>
    Effect.gen(function* () {
      const sandbox = {} as SandboxClient;
      const pollUntilDoneEffectMock = vi.fn<OperationPoller<SandboxClient>['pollUntilDoneEffect']>(
        () => Effect.succeed(sandbox),
      );
      const createSandboxMock = vi.fn<SandboxGroupClient['createSandbox']>(
        () =>
          ({
            pollUntilDoneEffect: pollUntilDoneEffectMock,
          }) as unknown as OperationPoller<SandboxClient>,
      );
      const client = {
        createSandbox: createSandboxMock,
      } as unknown as SandboxGroupClient;

      const result = yield* createSandbox(client, { disk: 'ubuntu' });

      expect(result).toBe(sandbox);
      expect(createSandboxMock).toHaveBeenCalledWith({ disk: 'ubuntu' });
    }),
  );

  it.effect('deletes a sandbox after successful scoped use', () =>
    Effect.gen(function* () {
      const execMock = vi
        .fn<SandboxClient['exec']>()
        .mockResolvedValue({ stdout: 'hello', stderr: '', exitCode: 0 });
      const deleteMock = vi.fn<SandboxClient['delete']>(
        () =>
          ({
            pollUntilDoneEffect: () => Effect.void,
          }) as unknown as OperationPoller<void>,
      );
      const sandbox = {
        exec: execMock,
        delete: deleteMock,
      } as unknown as SandboxClient;
      const createSandboxMock = vi.fn<SandboxGroupClient['createSandbox']>(
        () =>
          ({
            pollUntilDoneEffect: () => Effect.succeed(sandbox),
          }) as unknown as OperationPoller<SandboxClient>,
      );
      const client = {
        createSandbox: createSandboxMock,
      } as unknown as SandboxGroupClient;

      const result = yield* withSandbox(client, { disk: 'ubuntu' }, (scopedSandbox) =>
        exec(scopedSandbox, 'echo hello'),
      );

      expect(result).toEqual({ stdout: 'hello', stderr: '', exitCode: 0 });
      expect(client.createSandbox).toHaveBeenCalledWith({ disk: 'ubuntu' });
      expect(sandbox.delete).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect('deletes a sandbox after failed scoped use', () =>
    Effect.gen(function* () {
      const deleteMock = vi.fn<SandboxClient['delete']>(
        () =>
          ({
            pollUntilDoneEffect: () => Effect.void,
          }) as unknown as OperationPoller<void>,
      );
      const sandbox = {
        delete: deleteMock,
      } as unknown as SandboxClient;
      const createSandboxMock = vi.fn<SandboxGroupClient['createSandbox']>(
        () =>
          ({
            pollUntilDoneEffect: () => Effect.succeed(sandbox),
          }) as unknown as OperationPoller<SandboxClient>,
      );
      const client = {
        createSandbox: createSandboxMock,
      } as unknown as SandboxGroupClient;

      const result = yield* Effect.either(withSandbox(client, {}, () => Effect.fail('use failed')));

      expect(Either.isLeft(result)).toBe(true);

      if (Either.isLeft(result)) {
        expect(result.left).toBe('use failed');
      }

      expect(sandbox.delete).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect('exposes paged results as streams', () =>
    Effect.gen(function* () {
      const client = {
        listSandboxes: () =>
          (async function* () {
            yield { id: 'sandbox-1', state: 'Running' };
            yield { id: 'sandbox-2', state: 'Stopped' };
          })(),
      } as unknown as SandboxGroupClient;

      const items = yield* listSandboxes(client).pipe(Stream.runCollect);

      expect(Array.from(items).map((sandbox) => sandbox.id)).toEqual(['sandbox-1', 'sandbox-2']);
    }),
  );

  it.effect('builds the sandbox group service from Config and AzureCredential', () =>
    Effect.gen(function* () {
      const credential: TokenCredential = {
        getToken: vi
          .fn()
          .mockResolvedValue({ token: 'token', expiresOnTimestamp: Date.now() + 60_000 }),
      };
      const provider = ConfigProvider.fromMap(
        new Map([
          ['AZURE_SUBSCRIPTION_ID', 'sub'],
          ['AZURE_RESOURCE_GROUP', 'rg'],
          ['AZURE_SANDBOX_GROUP', 'group'],
          ['AZURE_REGION', 'eastus2'],
        ]),
      );

      const service = yield* AcaSandboxes.pipe(
        Effect.provide(AcaSandboxes.layerConfig()),
        Effect.provide(Layer.succeed(AzureCredential, credential)),
        Effect.withConfigProvider(provider),
      );

      expect(service.client.subscriptionId).toBe('sub');
      expect(service.client.resourceGroup).toBe('rg');
      expect(service.client.sandboxGroup).toBe('group');
    }),
  );
});
