import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPayload, buildPaymentParams, crc16, formatRecipient, isExpired, parsePayment,
  validatePayment, type PaymentDetails,
} from '../src/lib/paynow';
import { externalChecksumExamples, externalWithReference, externalWithoutReference, fields, independentCrc } from './fixtures';

const base: PaymentDetails = {
  type: 'uen', recipient: '12345678A', reference: 'abc 123',
  amount: '5.12', editable: false, expires: 1723433689000,
};

afterEach(() => vi.useRealTimers());

describe('example codes written outside this app', () => {
  it.each([
    ...externalChecksumExamples,
    [externalWithReference.slice(0, -4), 'E602'],
    [externalWithoutReference.slice(0, -4), '9A71'],
    ['123456789', '29B1'], // standard CRC-16/CCITT-FALSE check vector
  ])('matches the known checksum for %s', (input, expected) => {
    expect(crc16(input)).toBe(expected);
    expect(independentCrc(input)).toBe(expected);
  });

  it.each([
    [externalWithReference, 'abc 123'],
    [externalWithoutReference, ''],
  ])('matches all payment details in the external example', (fixture, reference) => {
    const actual = fields(buildPayload({ ...base, reference }));
    const expected = fields(fixture);
    // Merchant name differs deliberately: UI collects a proxy, not a bank-verified name.
    // Field order differs too; compare parsed fields, not a misleading byte equality.
    for (const tag of ['00', '01', '26', '52', '53', '54', '58', '60', '62']) {
      expect(actual[tag], `field ${tag}`).toEqual(expected[tag]);
    }
    expect(actual['59']).toBe('NA');
    expect(fields(actual['26']!)).toEqual({
      '00': 'SG.PAYNOW', '01': '2', '02': '12345678A',
      '03': '0', '04': '20240812113449',
    });
  });
});

describe('encoding regression matrix', () => {
  for (const type of ['mobile', 'uen'] as const) {
    for (const amount of [undefined, '0.01', '5.10', '999999999.99']) {
      for (const editable of [false, true]) {
        for (const reference of ['', 'abc 123', 'INV-26.11/14 & #1 + ?=25']) {
          it(`${type}, ${amount ?? 'open amount'}, editable=${editable}, ref=${reference}`, () => {
            const input = { ...base, type, recipient: type === 'mobile' ? '91234567' : '12345678A', amount, editable, reference };
            const payload = buildPayload(input);
            const root = fields(payload);
            const paynow = fields(root['26']!);
            expect(root['00']).toBe('01');
            expect(root['01']).toBe('11');
            expect(root['52']).toBe('0000');
            expect(root['53']).toBe('702');
            expect(root['54']).toBe(amount);
            expect(root['58']).toBe('SG');
            expect(paynow['01']).toBe(type === 'mobile' ? '0' : '2');
            expect(paynow['02']).toBe(type === 'mobile' ? '+6591234567' : '12345678A');
            expect(paynow['03']).toBe(!amount || editable ? '1' : '0');
            expect(root['62'] ? fields(root['62'])['01'] : '').toBe(reference);
            expect(payload.slice(-8, -4)).toBe('6304');
            expect(root['63']).toBe(independentCrc(payload.slice(0, -4)));
            expect(parsePayment(`?${buildPaymentParams(input)}`)).toEqual(validatePayment(input));
          });
        }
      }
    }
  }

  it.each(['91234567', '+6591234567', '6591234567', '+65 9123 4567', '(9123) 4567'])('normalizes mobile %s once', recipient => {
    const p = { ...base, type: 'mobile' as const, recipient };
    expect(fields(fields(buildPayload(p))['26']!)['02']).toBe('+6591234567');
  });
  it.each(['12345678A', '209912345K', 'T99LL9999X', '209912345K001'])('accepts UEN form %s', recipient => {
    expect(validatePayment({ ...base, recipient }).recipient).toBe(recipient);
  });
  it('omits optional expiry, amount and additional data instead of encoding blanks', () => {
    const root = fields(buildPayload({ ...base, reference: '', amount: undefined, expires: undefined }));
    expect(root).not.toHaveProperty('54');
    expect(root).not.toHaveProperty('62');
    expect(fields(root['26']!)).not.toHaveProperty('04');
  });
  it('preserves a 25-character reference, not a silently sanitized replacement', () => {
    const reference = 'A'.repeat(25);
    expect(fields(fields(buildPayload({ ...base, reference }))['62']!)['01']).toBe(reference);
  });
  it.each(['5', '5.1', '0005.10'])('formats %s as decimal SGD, not cents', amount => {
    expect(fields(buildPayload({ ...base, amount }))['54']).toBe(amount === '5' ? '5.00' : '5.10');
  });
  it('covers the 6304 prefix and changes checksum when payment details change', () => {
    const payload = buildPayload(base);
    expect(payload.slice(-4)).not.toBe(crc16(payload.slice(0, -8)));
    expect(buildPayload({ ...base, amount: '5.13' }).slice(-4)).not.toBe(payload.slice(-4));
  });
});

describe('expiry and URL durability', () => {
  it('uses Singapore time across a UTC date/year boundary', () => {
    const expires = Date.parse('2026-12-31T18:05:06Z');
    expect(fields(fields(buildPayload({ ...base, expires }))['26']!)['04']).toBe('20270101020506');
  });
  it('never extends expiry on repeated URL reads', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1723433688000);
    const url = `?${buildPaymentParams(base)}`;
    expect(isExpired(parsePayment(url)!)).toBe(false);
    vi.setSystemTime(base.expires!);
    expect(parsePayment(url)!.expires).toBe(base.expires);
    expect(isExpired(parsePayment(url)!)).toBe(true);
  });
  it('round-trips literal plus signs and punctuation through URL encoding', () => {
    const input = validatePayment({ ...base, type: 'mobile', recipient: '+6591234567', reference: 'A+B & #?= /' });
    const query = buildPaymentParams(input).toString();
    expect(query).toContain('recipient=%2B65');
    expect(parsePayment(query)).toEqual(input);
  });
  it('returns the form state for an empty URL', () => expect(parsePayment('')).toBeNull());
});

describe('invalid input fails explicitly', () => {
  it.each(['0', '-1', '1.001', '1e3', 'NaN', 'Infinity', '1,000', '1000000000', '0.00'])('rejects amount %s', amount => {
    expect(() => buildPayload({ ...base, amount })).toThrow();
  });
  it.each(['61234567', '+6091234567', '123', '912345670', '0091234567'])('rejects mobile %s', recipient => {
    expect(() => buildPayload({ ...base, type: 'mobile', recipient })).toThrow();
  });
  it.each(['', 'ABC', '12345678901234567890'])('rejects malformed UEN %s', recipient => {
    expect(() => buildPayload({ ...base, recipient })).toThrow();
  });
  it.each(['A'.repeat(26), '你好', 'line\nbreak', 'tab\there', '🙂'])('rejects unsupported reference %s', reference => {
    expect(() => buildPayload({ ...base, reference })).toThrow();
  });
  it.each([NaN, Infinity, -1, 0, 1.5, 253402271999001])('rejects expiry %s', expires => {
    expect(() => buildPayload({ ...base, expires })).toThrow();
  });
  it('rejects invalid query flags and recipient types', () => {
    expect(() => parsePayment('?recipient=12345678A&type=uen&editable=maybe')).toThrow();
    expect(() => parsePayment('?recipient=12345678A&type=bank')).toThrow();
  });
});

describe('NRIC/FIN payees', () => {
  it('encodes PayNow proxy type 1 with the full, upper-cased NRIC/FIN', () => {
    const paynow = fields(fields(buildPayload({ ...base, type: 'nric', recipient: ' s1234567d ' }))['26']!);
    expect(paynow['01']).toBe('1');
    expect(paynow['02']).toBe('S1234567D');
  });
  it.each(['S1234567D', 'T0123456Z', 'F1234567N', 'G7654321K', 'M1234567K'])('accepts %s', (recipient) => {
    expect(validatePayment({ ...base, type: 'nric', recipient }).recipient).toBe(recipient);
  });
  it.each(['1234567D', 'S123456D', 'S12345678D', 'A1234567D', 'S1234567', 'S 1234567 D!'])('rejects %s', (recipient) => {
    expect(() => validatePayment({ ...base, type: 'nric', recipient })).toThrow(/NRIC or FIN/);
  });
  it('shows only the last 4 characters on screen and in the picture', () => {
    expect(formatRecipient({ ...base, type: 'nric', recipient: 'S1234567D' })).toBe('S****567D');
  });
  it('round-trips through the link', () => {
    const input = validatePayment({ ...base, type: 'nric', recipient: 'S1234567D' });
    expect(parsePayment(buildPaymentParams(input).toString())).toEqual(input);
  });
});
