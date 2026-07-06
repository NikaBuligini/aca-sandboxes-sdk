import { Effect } from 'effect';

import { runPromise, sleepEffect, tryPromiseUnknown } from './effectRuntime.js';

export type PollResult<TResult> = {
  done: boolean;
  status?: string;
  result?: TResult;
};

export type PollUntilDoneOptions = {
  intervalInMs?: number;
  timeoutInMs?: number;
  abortSignal?: AbortSignal;
};

export class OperationPoller<TResult> {
  private readonly pollOperation: () => unknown;
  private latest?: PollResult<TResult>;

  constructor(pollOperation: () => Promise<PollResult<TResult>>);
  /** @internal */
  constructor(
    pollOperation: () => Promise<PollResult<TResult>> | Effect.Effect<PollResult<TResult>, unknown>,
  );
  constructor(
    pollOperation: () => Promise<PollResult<TResult>> | Effect.Effect<PollResult<TResult>, unknown>,
  ) {
    this.pollOperation = pollOperation;
  }

  get isDone(): boolean {
    return this.latest?.done ?? false;
  }

  get status(): string | undefined {
    return this.latest?.status;
  }

  get result(): TResult | undefined {
    return this.latest?.result;
  }

  poll(): Promise<PollResult<TResult>> {
    return runPromise(this.pollEffect());
  }

  /** @internal */
  pollEffect(): Effect.Effect<PollResult<TResult>, unknown> {
    return Effect.gen(this, function* () {
      const operation = this.pollOperation();
      const result = Effect.isEffect(operation)
        ? yield* operation as Effect.Effect<PollResult<TResult>, unknown>
        : yield* tryPromiseUnknown(() => operation as Promise<PollResult<TResult>>);
      this.latest = result;
      return result;
    });
  }

  pollUntilDone(options: PollUntilDoneOptions = {}): Promise<TResult> {
    return runPromise(this.pollUntilDoneEffect(options));
  }

  /** @internal */
  pollUntilDoneEffect(options: PollUntilDoneOptions = {}): Effect.Effect<TResult, unknown> {
    const intervalInMs = options.intervalInMs ?? 3_000;
    const timeoutInMs = options.timeoutInMs ?? 300_000;
    const deadline = Date.now() + timeoutInMs;

    return Effect.gen(this, function* () {
      while (true) {
        const result = yield* this.pollEffect();

        if (result.done) {
          return result.result as TResult;
        }

        if (Date.now() >= deadline) {
          return yield* Effect.fail(
            new Error(
              `Operation did not complete within ${timeoutInMs}ms. Last status: ${result.status ?? 'unknown'}.`,
            ),
          );
        }

        yield* sleepEffect(intervalInMs, options.abortSignal);
      }
    });
  }
}

export function statePoller<TResource, TResult>(options: {
  getResource: () => Promise<TResource> | Effect.Effect<TResource, unknown>;
  getState: (resource: TResource) => string | undefined;
  targetStates: string[];
  failedStates?: string[];
  transform: (resource: TResource) => TResult;
}): OperationPoller<TResult> {
  const targetStates = new Set(options.targetStates.map((state) => state.toLowerCase()));
  const failedStates = new Set((options.failedStates ?? []).map((state) => state.toLowerCase()));

  return new OperationPoller(() =>
    Effect.gen(function* () {
      const operation = options.getResource();
      const resource = Effect.isEffect(operation)
        ? yield* operation
        : yield* tryPromiseUnknown(() => operation);
      const status = options.getState(resource);
      const normalized = status?.toLowerCase();

      if (normalized && targetStates.has(normalized)) {
        return { done: true, status, result: options.transform(resource) };
      }

      if (normalized && failedStates.has(normalized)) {
        return yield* Effect.fail(new Error(`Operation failed with state '${status}'.`));
      }

      return { done: false, status };
    }),
  );
}
