import { describe, expect, it } from 'vitest';
import { markActiveProfileInResponse } from './profile-cache';

describe('profile cache helpers', () => {
  it('marks the switched profile as active in cached profile responses', () => {
    const updated = markActiveProfileInResponse(
      {
        activeProfileId: 'sami',
        profiles: [
          { id: 'default', name: 'default', isActive: false },
          { id: 'sami', name: 'sami', isActive: true },
        ],
      },
      'default',
    );

    expect(updated?.activeProfileId).toBe('default');
    expect(updated?.profiles).toEqual([
      { id: 'default', name: 'default', isActive: true },
      { id: 'sami', name: 'sami', isActive: false },
    ]);
  });
});
