import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform';
import type { HttpClientResponse } from '@effect/platform/HttpClientResponse';
import type { HttpMethod } from '@effect/platform/HttpMethod';
import { Effect } from 'effect';
import { Layer } from 'effect';

import { runPromise, sleepEffect, tryPromiseUnknown } from './effectRuntime.js';
import { AcaSandboxError } from './errors.js';
import type { TokenCredential } from './types.js';
import { normalizeEndpoint } from './util.js';

export type RetryOptions = {
  maxRetries?: number;
  retryDelayInMs?: number;
  maxRetryDelayInMs?: number;
  retryStatusCodes?: number[];
};

export type RestClientOptions = {
  endpoint: string;
  credential: TokenCredential;
  scope: string;
  apiVersion: string;
  fetch?: typeof fetch;
  retryOptions?: RetryOptions;
};

export type RequestOptions = {
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  responseType?: 'json' | 'binary' | 'text' | 'void';
  allowedStatusCodes?: number[];
  abortSignal?: AbortSignal;
  addApiVersion?: boolean;
};

export type RawResponse<T = unknown> = {
  status: number;
  headers: Headers;
  body: T;
};

const DEFAULT_RETRY_STATUS_CODES = [403, 408, 429, 500, 502, 503, 504];

export class RestClient {
  readonly endpoint: string;
  readonly apiVersion: string;

  private readonly credential: TokenCredential;
  private readonly scope: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retryOptions: Required<RetryOptions>;

  constructor(options: RestClientOptions) {
    if (!options.credential) {
      throw new Error(
        'credential is required. Use DefaultAzureCredential or another Azure TokenCredential.',
      );
    }

    this.endpoint = normalizeEndpoint(options.endpoint);
    this.credential = options.credential;
    this.scope = options.scope;
    this.apiVersion = options.apiVersion;
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error(
        'A fetch implementation is required. Use Node.js 18+ or pass fetch in client options.',
      );
    }

    this.retryOptions = {
      maxRetries: options.retryOptions?.maxRetries ?? 3,
      retryDelayInMs: options.retryOptions?.retryDelayInMs ?? 1_000,
      maxRetryDelayInMs: options.retryOptions?.maxRetryDelayInMs ?? 10_000,
      retryStatusCodes: options.retryOptions?.retryStatusCodes ?? DEFAULT_RETRY_STATUS_CODES,
    };
  }

  request<T = unknown>(
    method: string,
    pathOrUrl: string,
    options: RequestOptions = {},
  ): Promise<T> {
    return runPromise(this.requestEffect<T>(method, pathOrUrl, options));
  }

  requestRaw<T = unknown>(
    method: string,
    pathOrUrl: string,
    options: RequestOptions = {},
  ): Promise<RawResponse<T>> {
    return runPromise(this.requestRawEffect<T>(method, pathOrUrl, options));
  }

  /** @internal */
  requestEffect<T = unknown>(
    method: string,
    pathOrUrl: string,
    options: RequestOptions = {},
  ): Effect.Effect<T, unknown> {
    return Effect.map(
      this.requestRawEffect<T>(method, pathOrUrl, options),
      (response) => response.body,
    );
  }

  /** @internal */
  requestRawEffect<T = unknown>(
    method: string,
    pathOrUrl: string,
    options: RequestOptions = {},
  ): Effect.Effect<RawResponse<T>, unknown> {
    return Effect.gen(this, function* () {
      const token = yield* tryPromiseUnknown(() =>
        this.credential.getToken(this.scope, { abortSignal: options.abortSignal }),
      );

      if (!token) {
        return yield* Effect.fail(
          new Error(`Credential did not return an access token for scope ${this.scope}.`),
        );
      }

      const url = this.buildUrl(pathOrUrl, options.params, options.addApiVersion !== false);
      const headers = new Headers(options.headers);
      headers.set('Authorization', `Bearer ${token.token}`);
      headers.set('Accept', 'application/json');

      let request = HttpClientRequest.make(asHttpMethod(method))(url, {
        headers: headersToRecord(headers),
      });

      if (options.body !== undefined) {
        if (options.body instanceof Uint8Array) {
          request = HttpClientRequest.bodyUint8Array(
            request,
            options.body,
            headers.get('Content-Type') ?? undefined,
          );
        } else if (options.body instanceof ArrayBuffer || options.body instanceof Blob) {
          const bytes = yield* bodyToUint8Array(options.body);
          request = HttpClientRequest.bodyUint8Array(
            request,
            bytes,
            headers.get('Content-Type') ?? undefined,
          );
        } else if (typeof options.body === 'string') {
          request = HttpClientRequest.bodyText(
            request,
            options.body,
            headers.get('Content-Type') ?? undefined,
          );
        } else {
          const contentType = headers.get('Content-Type') ?? 'application/json';
          headers.set('Content-Type', contentType);
          request = HttpClientRequest.bodyText(request, JSON.stringify(options.body), contentType);
        }
      }

      let lastResponse: HttpClientResponse | undefined;

      for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt += 1) {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.execute(request);
        lastResponse = response;

        if (!this.shouldRetry(response, attempt)) {
          break;
        }

        yield* sleepEffect(this.retryDelay(response, attempt), options.abortSignal);
      }

      if (!lastResponse) {
        return yield* Effect.fail(new Error('No HTTP response was received.'));
      }

      const allowedStatusCodes = options.allowedStatusCodes ?? [];

      if (!isOkStatus(lastResponse.status) && !allowedStatusCodes.includes(lastResponse.status)) {
        const responseBody = yield* parseResponseBody(lastResponse, 'json');
        const message = errorMessage(lastResponse.status, responseBody);
        return yield* Effect.fail(new AcaSandboxError(message, lastResponse.status, responseBody));
      }

      const responseType = options.responseType ?? 'json';
      const parsed = yield* parseResponseBody(lastResponse, responseType);
      return {
        status: lastResponse.status,
        headers: platformHeadersToWeb(lastResponse.headers),
        body: parsed as T,
      };
    }).pipe(Effect.provide(this.httpLayer(options.abortSignal)));
  }

  validateContinuationUrl(nextLink: string): void {
    const expected = new URL(this.endpoint);
    const actual = new URL(nextLink);

    if (actual.protocol !== 'https:') {
      throw new Error(`Continuation URL uses insecure scheme: ${actual.protocol}`);
    }

    if (actual.hostname !== expected.hostname) {
      throw new Error(
        `Unexpected continuation URL host: ${actual.hostname}; expected ${expected.hostname}.`,
      );
    }
  }

  private buildUrl(
    pathOrUrl: string,
    params: RequestOptions['params'],
    addApiVersion: boolean,
  ): string {
    const url = pathOrUrl.startsWith('https://')
      ? new URL(pathOrUrl)
      : new URL(`${this.endpoint}${pathOrUrl}`);

    if (addApiVersion && !url.searchParams.has('api-version')) {
      url.searchParams.set('api-version', this.apiVersion);
    }

    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private shouldRetry(response: HttpClientResponse, attempt: number): boolean {
    return (
      attempt < this.retryOptions.maxRetries &&
      this.retryOptions.retryStatusCodes.includes(response.status)
    );
  }

  private retryDelay(response: HttpClientResponse, attempt: number): number {
    const retryAfter = platformHeadersToWeb(response.headers).get('Retry-After');

    if (retryAfter) {
      const seconds = Number(retryAfter);

      if (Number.isFinite(seconds)) {
        return seconds * 1_000;
      }
    }

    const delay = this.retryOptions.retryDelayInMs * 2 ** attempt;
    return Math.min(delay, this.retryOptions.maxRetryDelayInMs);
  }

  private httpLayer(abortSignal?: AbortSignal) {
    let layer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, this.fetchImpl)),
    );

    if (abortSignal) {
      layer = layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { signal: abortSignal })),
      );
    }

    return layer;
  }
}

function parseResponseBody(
  response: HttpClientResponse,
  responseType: RequestOptions['responseType'],
): Effect.Effect<unknown, unknown> {
  if (responseType === 'void' || response.status === 204) {
    return Effect.succeed(undefined);
  }

  if (responseType === 'binary') {
    return Effect.map(response.arrayBuffer, (body) => new Uint8Array(body));
  }

  return Effect.gen(function* () {
    const text = yield* response.text;

    if (responseType === 'text') {
      return text;
    }

    if (!text) {
      return undefined;
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  });
}

function errorMessage(statusCode: number, body: unknown): string {
  if (isRecord(body)) {
    const error = body.error;

    if (isRecord(error) && typeof error.message === 'string') {
      return error.message;
    }

    if (typeof body.message === 'string') {
      return body.message;
    }
  }
  return `ACA sandboxes request failed with status ${statusCode}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOkStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function asHttpMethod(method: string): HttpMethod {
  const upper = method.toUpperCase();

  if (
    upper === 'GET' ||
    upper === 'POST' ||
    upper === 'PUT' ||
    upper === 'DELETE' ||
    upper === 'PATCH' ||
    upper === 'HEAD' ||
    upper === 'OPTIONS'
  ) {
    return upper;
  }

  throw new Error(`Unsupported HTTP method: ${method}.`);
}

function headersToRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function platformHeadersToWeb(headers: Readonly<Record<string, string>>): Headers {
  return new Headers(headers);
}

function bodyToUint8Array(body: ArrayBuffer | Blob): Effect.Effect<Uint8Array, unknown> {
  if (body instanceof ArrayBuffer) {
    return Effect.succeed(new Uint8Array(body));
  }

  return tryPromiseUnknown(async () => new Uint8Array(await body.arrayBuffer()));
}
