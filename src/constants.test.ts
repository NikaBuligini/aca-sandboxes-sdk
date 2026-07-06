import { describe, expect, it } from 'vitest';

import { endpointForRegion, regionFromEndpoint } from './constants.js';

describe('endpoint helpers', () => {
  it('builds a regional ACA sandbox data-plane endpoint', () => {
    expect(endpointForRegion('eastus2')).toBe('https://management.eastus2.azuredevcompute.io');
  });

  it('extracts a region from a regional endpoint', () => {
    expect(regionFromEndpoint('https://management.westus2.azuredevcompute.io')).toBe('westus2');
  });

  it('rejects invalid region input', () => {
    expect(() => endpointForRegion('eastus2/path')).toThrow(
      'region must be a non-empty Azure region name',
    );
  });
});
