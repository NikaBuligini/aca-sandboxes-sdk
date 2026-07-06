import { Effect } from 'effect';

import { runPromise } from './effectRuntime.js';
import { OperationFailedError, PollTimeoutError } from './errors.js';

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

export class OperationPoller<TResult> implements PromiseLike<TResult> {
  private readonly pollOperation: () => Effect.Effect<PollResult<TResult>, unknown>;
  private latest?: PollResult<TResult>;
  private inFlightPoll?: Promise<PollResult<TResult>>;
  private completion?: Promise<TResult>;

  constructor(pollOperation: () => Promise<PollResult<TResult>>);
  /** @internal */
  constructor(
    pollOperation: () => Promise<PollResult<TResult>> | Effect.Effect<PollResult<TResult>, unknown>,
  );
  constructor(
    pollOperation: () => Promise<PollResult<TResult>> | Effect.Effect<PollResult<TResult>, unknown>,
  ) {
    this.pollOperation = () => {
      const operation = pollOperation();
      return Effect.isEffect(operation)
        ? operation
        : Effect.tryPromise({
            try: () => operation,
            catch: (error) => error,
          });
    };
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

  start(): this {
    void this.poll().catch(() => undefined);
    return this;
  }

  poll(): Promise<PollResult<TResult>> {
    this.inFlightPoll ??= runPromise(this.executePollEffect()).finally(() => {
      this.inFlightPoll = undefined;
    });
    return this.inFlightPoll;
  }

  /** @internal */
  pollEffect(): Effect.Effect<PollResult<TResult>, unknown> {
    return Effect.tryPromise({
      try: () => this.poll(),
      catch: (error) => error,
    });
  }

  private executePollEffect(): Effect.Effect<PollResult<TResult>, unknown> {
    return Effect.gen(this, function* () {
      const result = yield* this.pollOperation();
      this.latest = result;
      return result;
    });
  }

  pollUntilDone(options: PollUntilDoneOptions = {}): Promise<TResult> {
    this.completion ??= runPromise(this.pollUntilDoneEffect(options), {
      signal: options.abortSignal,
    });
    return this.completion;
  }

  // oxlint-disable-next-line unicorn/no-thenable
  then<TResult1 = TResult, TResult2 = never>(
    onfulfilled?: ((value: TResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.pollUntilDone().then(onfulfilled, onrejected);
  }

  catch<TCatch = never>(
    onrejected?: ((reason: unknown) => TCatch | PromiseLike<TCatch>) | null,
  ): Promise<TResult | TCatch> {
    return this.pollUntilDone().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<TResult> {
    return this.pollUntilDone().finally(onfinally);
  }

  /** @internal */
  pollUntilDoneEffect(options: PollUntilDoneOptions = {}): Effect.Effect<TResult, unknown> {
    const intervalInMs = options.intervalInMs ?? 3_000;
    const timeoutInMs = options.timeoutInMs ?? 300_000;
    let lastStatus: string | undefined;

    const loop = Effect.gen(this, function* () {
      while (true) {
        const result = yield* this.pollEffect();
        lastStatus = result.status;

        if (result.done) {
          return result.result as TResult;
        }

        yield* Effect.sleep(intervalInMs);
      }
    });

    return loop.pipe(
      Effect.timeoutFail({
        duration: timeoutInMs,
        onTimeout: () => new PollTimeoutError({ timeoutInMs, lastStatus }),
      }),
    );
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
        : yield* Effect.tryPromise({
            try: () => operation,
            catch: (error) => error,
          });
      const status = options.getState(resource);
      const normalized = status?.toLowerCase();

      if (normalized && targetStates.has(normalized)) {
        return { done: true, status, result: options.transform(resource) };
      }

      if (normalized && failedStates.has(normalized)) {
        return yield* Effect.fail(
          new OperationFailedError({
            message: `Operation failed with state '${status}'.`,
            status,
            details: resource,
          }),
        );
      }

      return { done: false, status };
    }),
  );
}
