import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Either } from 'effect';

import { AcaSandboxError } from './errors.js';
import { createSandbox, exec, pollUntilDone, toEffectError, withSandbox } from './effect.js';
import type { OperationPoller } from './poller.js';
import type { SandboxClient } from './sandboxClient.js';
import type { SandboxGroupClient } from './sandboxGroupClient.js';

describe('Effect adapter', () => {
  it.effect('wraps Promise SDK calls', () =>
    Effect.gen(function* () {
      const execMock = vi
        .fn<SandboxClient['exec']>()
        .mockResolvedValue({ stdout: 'hello', exitCode: 0 });
      const sandbox = {
        exec: execMock,
      } as unknown as SandboxClient;

      const result = yield* exec(sandbox, 'echo hello');

      expect(result).toEqual({ stdout: 'hello', exitCode: 0 });
      expect(sandbox.exec).toHaveBeenCalledWith('echo hello', {});
    }),
  );

  it('maps SDK HTTP errors into tagged Effect errors', () => {
    const error = new AcaSandboxError('missing', 404, { error: { message: 'missing' } });

    expect(toEffectError(error)).toEqual({ _tag: 'HttpError', cause: error });
    expect(toEffectError('boom')).toEqual({ _tag: 'UnknownError', cause: 'boom' });
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
      const beginCreateSandboxMock = vi.fn<SandboxGroupClient['beginCreateSandbox']>(
        () =>
          ({
            pollUntilDoneEffect: pollUntilDoneEffectMock,
          }) as unknown as OperationPoller<SandboxClient>,
      );
      const client = {
        beginCreateSandbox: beginCreateSandboxMock,
      } as unknown as SandboxGroupClient;

      const result = yield* createSandbox(client, { disk: 'ubuntu' });

      expect(result).toBe(sandbox);
      expect(beginCreateSandboxMock).toHaveBeenCalledWith({ disk: 'ubuntu' });
    }),
  );

  it.effect('deletes a sandbox after successful scoped use', () =>
    Effect.gen(function* () {
      const execMock = vi.fn<SandboxClient['exec']>().mockResolvedValue({ stdout: 'hello' });
      const deleteMock = vi.fn<SandboxClient['delete']>().mockResolvedValue(undefined);
      const sandbox = {
        exec: execMock,
        delete: deleteMock,
      } as unknown as SandboxClient;
      const beginCreateSandboxMock = vi.fn<SandboxGroupClient['beginCreateSandbox']>(
        () =>
          ({
            pollUntilDoneEffect: () => Effect.succeed(sandbox),
          }) as unknown as OperationPoller<SandboxClient>,
      );
      const client = {
        beginCreateSandbox: beginCreateSandboxMock,
      } as unknown as SandboxGroupClient;

      const result = yield* withSandbox(client, { disk: 'ubuntu' }, (scopedSandbox) =>
        exec(scopedSandbox, 'echo hello'),
      );

      expect(result).toEqual({ stdout: 'hello' });
      expect(client.beginCreateSandbox).toHaveBeenCalledWith({ disk: 'ubuntu' });
      expect(sandbox.delete).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect('deletes a sandbox after failed scoped use', () =>
    Effect.gen(function* () {
      const deleteMock = vi.fn<SandboxClient['delete']>().mockResolvedValue(undefined);
      const sandbox = {
        delete: deleteMock,
      } as unknown as SandboxClient;
      const beginCreateSandboxMock = vi.fn<SandboxGroupClient['beginCreateSandbox']>(
        () =>
          ({
            pollUntilDoneEffect: () => Effect.succeed(sandbox),
          }) as unknown as OperationPoller<SandboxClient>,
      );
      const client = {
        beginCreateSandbox: beginCreateSandboxMock,
      } as unknown as SandboxGroupClient;

      const result = yield* Effect.either(withSandbox(client, {}, () => Effect.fail('use failed')));

      expect(Either.isLeft(result)).toBe(true);

      if (Either.isLeft(result)) {
        expect(result.left).toBe('use failed');
      }

      expect(sandbox.delete).toHaveBeenCalledTimes(1);
    }),
  );
});
