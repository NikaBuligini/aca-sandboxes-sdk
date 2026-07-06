export function validatePathSegment(value: string, name: string): string {
  if (
    !value ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('..') ||
    value.includes('\0')
  ) {
    throw new Error(`Invalid ${name}: must not contain '/', '\\', '..', or null bytes.`);
  }
  return value;
}

export function pathSegment(value: string, name: string): string {
  return encodeURIComponent(validatePathSegment(value, name));
}

export function normalizeEndpoint(endpoint: string): string {
  if (!endpoint.startsWith('https://')) {
    throw new Error(
      'endpoint must use HTTPS. Use endpointForRegion() to construct a regional endpoint.',
    );
  }
  return endpoint.replace(/\/+$/, '');
}

export function labelsToSelector(labels?: Record<string, string>): string | undefined {
  if (!labels || Object.keys(labels).length === 0) {
    return undefined;
  }
  return Object.entries(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
}

export function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) {
    return Promise.reject(abortSignal.reason ?? new Error('The operation was aborted.'));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    abortSignal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(abortSignal.reason ?? new Error('The operation was aborted.'));
      },
      { once: true },
    );
  });
}

export function toUint8Array(content: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }

  if (content instanceof Uint8Array) {
    return content;
  }
  return new Uint8Array(content);
}

export function boolParam(value: boolean): string {
  return value ? 'true' : 'false';
}
