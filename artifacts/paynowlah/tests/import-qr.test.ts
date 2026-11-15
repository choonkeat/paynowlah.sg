import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { findQrText, parsePayNowText } from '../src/lib/import-qr';
import { buildPayload, validatePayment, type PaymentDetails } from '../src/lib/paynow';
import { externalWithReference, independentCrc } from './fixtures';

function withCrc(body: string): string {
  return body + '6304' + independentCrc(body + '6304');
}

describe('reading PayNow QR text back into form details', () => {
  const cases: PaymentDetails[] = [
    { type: 'mobile', recipient: '91234567', reference: 'Durian party', amount: '12.50', editable: false },
    { type: 'mobile', recipient: '+6581234567', reference: '', editable: true },
    { type: 'uen', recipient: '201912345K', reference: 'INV-1234', amount: '0.01', editable: true, expires: Date.parse('2026-12-31T18:05:06Z') },
    { type: 'uen', recipient: 'T08LL1234AXYZ', reference: 'A+B & #?= /', editable: true },
    { type: 'nric', recipient: 'g1234567x', reference: 'Angpow', amount: '88.00', editable: false },
  ];
  it.each(cases)('round-trips what Paynowlah makes: %o', (input) => {
    expect(parsePayNowText(buildPayload(input))).toEqual(validatePayment(input));
  });

  it('reads a QR made by another generator, with its expiry in Singapore time', () => {
    const details = parsePayNowText(externalWithReference);
    expect(details).toMatchObject({ type: 'uen', recipient: '12345678A', reference: 'abc 123', amount: '5.12', editable: false });
    expect(new Date(details.expires!).toISOString()).toBe('2024-08-12T03:34:49.000Z');
  });

  it('treats a date-only expiry as the end of that Singapore day', () => {
    const merchant = '0009SG.PAYNOW' + '01010' + '020891234567' + '03011' + '040820261231';
    const text = withCrc(`000201010211${'26' + merchant.length + merchant}5204000053037025802SG5902NA6009Singapore`);
    expect(new Date(parsePayNowText(text).expires!).toISOString()).toBe('2026-12-31T15:59:59.000Z');
  });

  it('falls back to the PayNow reference field, and drops a "payer types it" placeholder', () => {
    const merchant = '0009SG.PAYNOW' + '01012' + '0210201912345K' + '03011' + '0506INV-77';
    const text = withCrc(`000201010211${'26' + merchant.length + merchant}5204000053037025802SG62070103***`);
    expect(parsePayNowText(text)).toMatchObject({ reference: 'INV-77', type: 'uen' });
  });

  it('ignores surrounding spaces from copy and paste', () => {
    expect(parsePayNowText(`  ${buildPayload(cases[0]!)}\n`).recipient).toBe('+6591234567');
  });

  it.each([
    ['plain text', 'hello world', /not a PayNow QR/],
    ['a web link', 'https://example.com', /not a PayNow QR/],
    ['a cut-off copy', buildPayload(cases[0]!).slice(0, -6), /incomplete or was changed/],
    ['a changed copy', buildPayload(cases[0]!).replace('12.50', '99.50'), /incomplete or was changed/],
  ])('rejects %s with a plain message', (_name, text, message) => {
    expect(() => parsePayNowText(text)).toThrow(message);
  });

  it('reads NRIC/FIN payees', () => {
    const merchant = '0009SG.PAYNOW' + '01011' + '0209S1234567D' + '03011';
    const text = withCrc(`000201010211${'26' + merchant.length + merchant}5204000053037025802SG`);
    expect(parsePayNowText(text)).toMatchObject({ type: 'nric', recipient: 'S1234567D' });
  });

  it('says other payee kinds are not supported', () => {
    const merchant = '0009SG.PAYNOW' + '01013' + '0205ABCDE' + '03011';
    const text = withCrc(`000201010211${'26' + merchant.length + merchant}5204000053037025802SG`);
    expect(() => parsePayNowText(text)).toThrow(/does not support/);
  });

  it('rejects other countries’ QR payments', () => {
    const merchant = '0016A000000677010111' + '0113006612345678';
    const text = withCrc(`000201010211${'29' + merchant.length + merchant}5303764` + '5802TH');
    expect(() => parsePayNowText(text)).toThrow(/not a PayNow QR/);
  });
});

const wasm = readFileSync(new URL('../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url));
const wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer;

describe('finding a QR code in a picture', () => {
  it('reads a tilted phone photo of a screen showing a Paynowlah QR', async () => {
    // Real photo from a user test: moire, glare and a 90-degree turn. The lighter jsQR reader failed on it.
    const image = await loadImage(readFileSync(new URL('./screen-photo.jpg', import.meta.url)));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const text = await findQrText(new Uint8ClampedArray(ctx.getImageData(0, 0, image.width, image.height).data), image.width, image.height, wasmBinary);
    expect(parsePayNowText(text!)).toMatchObject({ type: 'nric', recipient: 'S0000001I', amount: '0.99', reference: 'hello' });
  });

  it('reads the QR text back out of rendered pixels', async () => {
    const text = buildPayload({ type: 'uen', recipient: '201912345K', reference: 'INV-1234', amount: '9.99', editable: false });
    const qr = QRCode.create(text, { errorCorrectionLevel: 'H' });
    const scale = 6, margin = 4, n = qr.modules.size, size = (n + margin * 2) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const mx = Math.floor(x / scale) - margin, my = Math.floor(y / scale) - margin;
        if (mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.get(my, mx)) {
          const i = (y * size + x) * 4;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        }
      }
    }
    expect(await findQrText(pixels, size, size, wasmBinary)).toBe(text);
  });

  it('returns null for a blank picture', async () => {
    expect(await findQrText(new Uint8ClampedArray(100 * 100 * 4).fill(255), 100, 100, wasmBinary)).toBeNull();
  });
});
