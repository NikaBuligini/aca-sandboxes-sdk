import { isNotFoundError } from '../errors.js';

export const ACA_PROVIDER_ID = 'aca-sandbox';

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function commandWithEnv(command: string, env?: Record<string, string>): string {
  const entries = Object.entries(env ?? {});

  if (entries.length === 0) {
    return command;
  }

  for (const [key] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }
  }
  return `env ${entries.map(([key, value]) => shellQuote(`${key}=${value}`)).join(' ')} bash -lc ${shellQuote(command)}`;
}

export function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function shouldReturnNullForRead(error: unknown): boolean {
  if (isNotFoundError(error)) {
    return true;
  }

  if (error == null || typeof error !== 'object') {
    return false;
  }

  const message = (error as { message?: unknown }).message;
  return (
    typeof message === 'string' && /no such file|not found|does not exist|ENOENT/i.test(message)
  );
}

export function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw abortSignal.reason ?? new DOMException('Aborted', 'AbortError');
  }
}
