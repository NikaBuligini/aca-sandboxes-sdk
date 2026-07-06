import { Effect, Option, Stream } from 'effect';

import type { RestClientError } from './http.js';
import type { RestClient } from './http.js';

type PageResponse<T> = {
  value?: T[];
  nextLink?: string;
  [key: string]: unknown;
};

export async function* listPaged<T>(options: {
  client: RestClient;
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  itemKey?: string;
}): AsyncIterable<T> {
  let nextLink: string | undefined;
  let firstPage = true;

  do {
    const data = nextLink
      ? await getContinuation<T>(options.client, nextLink)
      : await options.client.request<T[] | PageResponse<T>>('GET', options.path, {
          params: firstPage ? options.params : undefined,
        });

    firstPage = false;

    const page = parsePage<T>(data, options.itemKey);

    for (const item of page.items) {
      yield item;
    }
    nextLink = page.nextLink;
  } while (nextLink);
}

export function listPagedStream<T>(options: {
  client: RestClient;
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  itemKey?: string;
}): Stream.Stream<T, RestClientError> {
  type State = { readonly nextLink?: string; readonly firstPage: boolean };

  return Stream.paginateEffect({ firstPage: true } as State, (state) =>
    Effect.map(fetchPage<T>(options, state), (data) => {
      const page = parsePage<T>(data, options.itemKey);
      const nextState = page.nextLink
        ? Option.some({ nextLink: page.nextLink, firstPage: false } as State)
        : Option.none<State>();
      return [page.items, nextState] as const;
    }),
  ).pipe(Stream.flatMap((items) => Stream.fromIterable(items)));
}

export class PagedIterable<T> implements AsyncIterable<T> {
  constructor(private readonly createIterator: () => AsyncIterable<T>) {}

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this.createIterator()[Symbol.asyncIterator]();
  }

  async toArray(): Promise<T[]> {
    const items: T[] = [];

    for await (const item of this) {
      items.push(item);
    }
    return items;
  }
}

async function getContinuation<T>(
  client: RestClient,
  nextLink: string,
): Promise<T[] | PageResponse<T>> {
  client.validateContinuationUrl(nextLink);
  return client.request<T[] | PageResponse<T>>('GET', nextLink, { addApiVersion: false });
}

function fetchPage<T>(
  options: {
    readonly client: RestClient;
    readonly path: string;
    readonly params?: Record<string, string | number | boolean | undefined>;
  },
  state: { readonly nextLink?: string; readonly firstPage: boolean },
): Effect.Effect<T[] | PageResponse<T>, RestClientError> {
  if (state.nextLink) {
    return Effect.sync(() => options.client.validateContinuationUrl(state.nextLink as string)).pipe(
      Effect.flatMap(() =>
        options.client.requestEffect<T[] | PageResponse<T>>('GET', state.nextLink as string, {
          addApiVersion: false,
        }),
      ),
    );
  }

  return options.client.requestEffect<T[] | PageResponse<T>>('GET', options.path, {
    params: state.firstPage ? options.params : undefined,
  });
}

function parsePage<T>(
  data: T[] | PageResponse<T>,
  itemKey = 'value',
): { readonly items: readonly T[]; readonly nextLink?: string } {
  if (Array.isArray(data)) {
    return { items: data };
  }

  const items = Array.isArray(data[itemKey])
    ? (data[itemKey] as T[])
    : Array.isArray(data.value)
      ? data.value
      : [];

  return {
    items,
    nextLink: typeof data.nextLink === 'string' ? data.nextLink : undefined,
  };
}
