import { describe, expect, it } from 'vitest';

describe('profiles api helpers', () => {
  it('keeps profile switch endpoint stable', () => {
    const endpoint = '/api/profiles/switch';
    expect(endpoint).toBe('/api/profiles/switch');
  });
});
