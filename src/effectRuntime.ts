import { Effect, Either } from 'effect';

import { sleep } from './util.js';

export async function runPromise<T>(effect: Effect.Effect<T, unknown>): Promise<T> {
  const result = await Effect.runPromise(Effect.either(effect));

  if (Either.isLeft(result)) {
    throw result.left;
  }

  return result.right;
}

export function tryPromiseUnknown<T>(evaluate: () => Promise<T>): Effect.Effect<T, unknown> {
  return Effect.tryPromise({
    try: evaluate,
    catch: (error) => error,
  });
}

export function sleepEffect(
  delayInMs: number,
  abortSignal?: AbortSignal,
): Effect.Effect<void, unknown> {
  return tryPromiseUnknown(() => sleep(delayInMs, abortSignal));
}
