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

    if (Array.isArray(data)) {
      for (const item of data) {
        yield item;
      }
      nextLink = undefined;
      continue;
    }

    const itemKey = options.itemKey ?? 'value';
    const items = Array.isArray(data[itemKey])
      ? (data[itemKey] as T[])
      : Array.isArray(data.value)
        ? data.value
        : [];

    for (const item of items) {
      yield item;
    }
    nextLink = typeof data.nextLink === 'string' ? data.nextLink : undefined;
  } while (nextLink);
}

async function getContinuation<T>(
  client: RestClient,
  nextLink: string,
): Promise<T[] | PageResponse<T>> {
  client.validateContinuationUrl(nextLink);
  return client.request<T[] | PageResponse<T>>('GET', nextLink, { addApiVersion: false });
}
