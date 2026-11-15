import { crc16, validatePayment, type PaymentDetails } from './paynow';

const NOT_PAYNOW = 'This is not a PayNow QR code.';

/** Strict reader for the EMV "tag, 2-digit length, value" format. */
function readFields(text: string): Map<string, string> {
  const result = new Map<string, string>();
  let cursor = 0;
  while (cursor < text.length) {
    const header = text.slice(cursor, cursor + 4);
    if (!/^\d{4}$/.test(header)) throw new Error(NOT_PAYNOW);
    const length = Number(header.slice(2));
    cursor += 4;
    if (cursor + length > text.length) throw new Error(NOT_PAYNOW);
    if (!result.has(header.slice(0, 2))) result.set(header.slice(0, 2), text.slice(cursor, cursor + length));
    cursor += length;
  }
  return result;
}

/** PayNow expiry is Singapore local time: yyyyMMdd (end of that day) or yyyyMMddHHmmss. */
function parseExpiry(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/.exec(value);
  if (!m) throw new Error('The expiry date in this QR code is not readable.');
  const [, y, mo, d, h = '23', mi = '59', s = '59'] = m;
  const ms = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s) - 8 * 3600_000;
  if (!Number.isFinite(ms)) throw new Error('The expiry date in this QR code is not readable.');
  return ms;
}

/** Turns the text inside a PayNow QR code back into form details. */
export function parsePayNowText(raw: string): PaymentDetails {
  const text = raw.trim();
  if (!/^000201/.test(text)) throw new Error(NOT_PAYNOW);
  const crcAt = text.lastIndexOf('6304');
  if (crcAt !== text.length - 8 || crc16(text.slice(0, -4)) !== text.slice(-4).toUpperCase()) {
    throw new Error('This QR code text is incomplete or was changed. Copy it again in full.');
  }
  const root = readFields(text);
  // The PayNow block can sit in any merchant slot 26–51; find it by its name.
  let paynow: Map<string, string> | undefined;
  for (let tag = 26; tag <= 51; tag++) {
    const value = root.get(String(tag));
    if (!value) continue;
    try {
      const sub = readFields(value);
      if (sub.get('00')?.toUpperCase() === 'SG.PAYNOW') { paynow = sub; break; }
    } catch { /* another scheme's block; keep looking */ }
  }
  if (!paynow) throw new Error(NOT_PAYNOW);

  const proxyType = paynow.get('01');
  const type = proxyType === '0' ? 'mobile' : proxyType === '1' ? 'nric' : proxyType === '2' ? 'uen' : null;
  if (!type) throw new Error('This QR code pays to a kind of PayNow account Paynowlah does not support.');
  let reference = '';
  const extra = root.get('62');
  if (extra) {
    try { reference = readFields(extra).get('01') ?? ''; } catch { /* ignore unreadable extras */ }
  }
  if (!reference || reference === '***') reference = paynow.get('05') ?? '';
  if (reference === '***') reference = '';

  const amount = root.get('54');
  return validatePayment({
    type,
    recipient: paynow.get('02') ?? '',
    reference,
    amount: amount || undefined,
    editable: paynow.get('03') !== '0',
    expires: paynow.has('04') ? parseExpiry(paynow.get('04')!) : undefined,
  });
}

let readerReady: Promise<typeof import('zxing-wasm/reader')> | undefined;

/**
 * ZXing's reader (compiled to WebAssembly) copes with phone photos of screens,
 * glare and tilt far better than lighter decoders. It is fetched from our own
 * site, and only when someone imports a picture, so the main page stays small.
 */
function loadReader(wasmBinary?: ArrayBuffer) {
  readerReady ??= (async () => {
    const zxing = await import('zxing-wasm/reader');
    if (wasmBinary) {
      zxing.prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
    } else {
      const { default: wasmUrl } = await import('zxing-wasm/reader/zxing_reader.wasm?url');
      zxing.prepareZXingModule({
        overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
        fireImmediately: true,
      });
    }
    return zxing;
  })();
  return readerReady;
}

/** Starts downloading the reader early (e.g. when the import box opens) so reading feels quicker. */
export function preloadQrReader(): void {
  loadReader().catch(() => { readerReady = undefined; });
}

/** Finds a QR code in raw RGBA pixels. Returns its text, or null if none is found. */
export async function findQrText(
  data: Uint8ClampedArray, width: number, height: number, wasmBinary?: ArrayBuffer,
): Promise<string | null> {
  const { readBarcodes } = await loadReader(wasmBinary);
  const [found] = await readBarcodes(
    { data, width, height, colorSpace: 'srgb' } as ImageData,
    { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 },
  );
  return found?.isValid ? found.text : null;
}

/** Reads a QR code from an image file or pasted picture, entirely in the browser. */
export async function readQrImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('That file is not a picture this browser can open.');
  });
  try {
    // Phone photos are huge; shrink first, then try larger if the QR code is small in the frame.
    for (const max of [1200, 2400]) {
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Your browser cannot read pictures here.');
      ctx.drawImage(bitmap, 0, 0, w, h);
      const found = await findQrText(ctx.getImageData(0, 0, w, h).data, w, h);
      if (found) return found;
      if (scale === 1) break;
    }
  } finally {
    bitmap.close();
  }
  throw new Error('No QR code found in that picture. Try a sharper or closer photo.');
}
