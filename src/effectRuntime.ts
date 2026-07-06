import { Cause, Effect, Exit } from 'effect';

export async function runPromise<T, E>(
  effect: Effect.Effect<T, E>,
  options: { readonly signal?: AbortSignal } = {},
): Promise<T> {
  const result = await Effect.runPromiseExit(effect, options);

  return Exit.match(result, {
    onFailure: (cause) => {
      throw Cause.squash(cause);
    },
    onSuccess: (value) => value,
  });
}
