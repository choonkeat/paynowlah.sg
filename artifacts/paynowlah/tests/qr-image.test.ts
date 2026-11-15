import { createCanvas, loadImage, Image as NativeImage } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import jsQR from 'jsqr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPaymentImage } from '../src/lib/qr-image';
import { buildPayload, formatRecipient, type PaymentDetails } from '../src/lib/paynow';
import { fields, independentCrc } from './fixtures';

const textCalls: { text: string; x: number; y: number; font: string; top: number }[] = [];
const imageCalls: number[][] = [];
const panelRects: { y: number; height: number }[] = [];
beforeEach(() => {
  textCalls.length = 0;
  imageCalls.length = 0;
  panelRects.length = 0;
  // Resolve Vite's asset URL to the very same bundled logo bytes for Node Canvas.
  vi.stubGlobal('Image', class extends NativeImage {
    set src(_url: string) {
      super.src = readFileSync(new URL('../src/assets/paynow-logo.png', import.meta.url));
    }
  });
  // Run the actual browser renderer against a real Canvas implementation.
  // No QR/image function is mocked. Only document.createElement is adapted.
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`Unexpected element ${tag}`);
      const canvas = Object.assign(createCanvas(1, 1), { style: {} });
      const context = canvas.getContext('2d');
      const fillText = context.fillText.bind(context);
      const fillRect = context.fillRect.bind(context);
      vi.spyOn(context, 'fillRect').mockImplementation((x, y, width, height) => {
        if (context.fillStyle === '#f5eff7' || context.fillStyle === '#F5EFF7') {
          panelRects.push({ y, height });
        }
        fillRect(x, y, width, height);
      });
      const drawImage = context.drawImage.bind(context);
      vi.spyOn(context, 'drawImage').mockImplementation((image, ...args) => {
        imageCalls.push(args);
        Reflect.apply(drawImage, context, [image, ...args]);
      });
      vi.spyOn(context, 'fillText').mockImplementation((text, x, y, maxWidth) => {
        textCalls.push({ text: String(text), x, y, font: context.font, top: y - context.measureText(String(text)).actualBoundingBoxAscent });
        if (maxWidth === undefined) fillText(text, x, y);
        else fillText(text, x, y, maxWidth);
      });
      return canvas;
    },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const cases: PaymentDetails[] = [
  { type: 'mobile', recipient: '+6591234567', reference: '', editable: true },
  { type: 'mobile', recipient: '+6581234567', reference: 'Lunch 14 Nov', amount: '0.01', editable: false },
  { type: 'uen', recipient: '12345678A', reference: 'abc 123', amount: '5.12', editable: false },
  { type: 'uen', recipient: '209912345K001', reference: 'ABCDEFGHIJKLMNOPQRSTUVWXY', amount: '999999999.99', editable: true, expires: Date.parse('2099-12-31T15:59:59Z') },
];

describe('finished decorated PNG, not just QR source text', () => {
  it.each(cases)('decodes the actual saved PNG for $type / $recipient', async details => {
    const uri = await renderPaymentImage(details);
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    const image = await loadImage(uri);
    expect([image.width, image.height]).toEqual([1000, 1000]);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height);
    const decoded = jsQR(new Uint8ClampedArray(pixels.data), image.width, image.height);
    expect(decoded?.data).toBe(buildPayload(details));
    const root = fields(decoded!.data);
    expect(root['63']).toBe(independentCrc(decoded!.data.slice(0, -4)));
    // The overlay and labels are painted into the actual exported canvas.
    expect(imageCalls.some(args => args.length === 4 && args[2] === 280 && args[3]! > 170)).toBe(true);
    for (const text of [
      formatRecipient(details),
      ...(details.reference ? [`Reference: ${details.reference}`] : []),
      details.amount ? `S$${details.amount}` : 'Any amount · SGD',
    ]) {
      expect(textCalls.some(c => c.text === text && c.y > 760 && c.y < image.height)).toBe(true);
    }
    expect(textCalls.find(c => c.text === formatRecipient(details))?.font).toContain('70px');
    expect(panelRects).toHaveLength(1);
    expect(textCalls.find(c => c.text === formatRecipient(details))!.top - panelRects[0]!.y).toBeGreaterThanOrEqual(12);
    expect(textCalls.find(c => c.text.startsWith('S$') || c.text.startsWith('Any amount'))?.font).toContain('96px');
    expect(textCalls.every(c => !/PayNow|SCAN TO PAY|PAY TO MOBILE|PAY TO UEN|fixed|editable/.test(c.text))).toBe(true);
    if (details.expires) {
      const expiryLine = textCalls.find(c => c.text.startsWith('Expires '))!;
      const referenceLine = textCalls.find(c => c.text.startsWith('Reference:'))!;
      expect(image.height - expiryLine.y).toBeGreaterThanOrEqual(32);
      expect(expiryLine.y - referenceLine.y).toBeGreaterThanOrEqual(36);
    }
  });
  it('still decodes after shrinking a dense decorated image to phone display size', async () => {
    const details = cases[3]!;
    const image = await loadImage(await renderPaymentImage(details));
    const canvas = createCanvas(360, Math.round(image.height * .36));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    expect(jsQR(new Uint8ClampedArray(pixels.data), canvas.width, canvas.height)?.data).toBe(buildPayload(details));
  });
  it('refuses to draw an expired QR image', async () => {
    await expect(renderPaymentImage({ ...cases[0]!, expires: 1 })).rejects.toThrow(/expired/i);
    expect(textCalls).toHaveLength(0);
  });
});
