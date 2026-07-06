import { describe, expect, it } from 'vitest';

import { boolParam, labelsToSelector, validatePathSegment } from './util.js';

describe('utility helpers', () => {
  it('serializes labels for selector query parameters', () => {
    expect(labelsToSelector({ tier: 'dev', worker: '1' })).toBe('tier=dev,worker=1');
  });

  it('validates URL path segments', () => {
    expect(validatePathSegment('sandbox-123', 'sandboxId')).toBe('sandbox-123');
    expect(() => validatePathSegment('../secret', 'sandboxId')).toThrow('Invalid sandboxId');
  });

  it('serializes booleans for query parameters', () => {
    expect(boolParam(true)).toBe('true');
    expect(boolParam(false)).toBe('false');
  });
});
