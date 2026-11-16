import { describe, expect, it } from 'vitest';
import { draftFromDetails, draftFromParams, draftToHash, emptyDraft, type Draft } from '../src/lib/draft';

const roundTrip = (d: Draft) => draftFromParams(new URLSearchParams(draftToHash(d)));

describe('still-editing links', () => {
  it('an empty form needs no address', () => {
    expect(draftToHash(emptyDraft())).toBe('');
  });

  it('keeps half-typed, unchecked values exactly as typed', () => {
    const d: Draft = { ...emptyDraft(), type: 'uen', recipient: '2019', reference: 'Durian & co', amount: '12.', editable: true, unit: 'hours', count: '' };
    expect(draftToHash(d).startsWith('edit&')).toBe(true);
    expect(roundTrip(d)).toEqual(d);
  });

  it('keeps an exact expiry when editing an existing QR', () => {
    const d = draftFromDetails({ type: 'mobile', recipient: '91234567', reference: 'x', amount: '5', editable: false, expires: 1723433689000 });
    expect(roundTrip(d)).toEqual(d);
  });

  it('carries the marker that reopens the form', () => {
    expect(new URLSearchParams(draftToHash({ ...emptyDraft(), recipient: '91234567' })).has('edit')).toBe(true);
  });

  it('ignores a made-up payee type', () => {
    expect(draftFromParams(new URLSearchParams('edit&type=bogus&recipient=1')).type).toBe('mobile');
  });
});
