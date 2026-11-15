import QRCode from 'qrcode';
import logoUrl from '../assets/paynow-logo.png';
import { buildPayload, formatRecipient, isExpired, validatePayment, type PaymentDetails } from './paynow';

function loadLogo(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the PayNow logo. Please reload and try again.'));
    image.src = logoUrl;
  });
}

/** One self-contained PNG: QR, central wordmark and payment details all share the canvas. */
export async function renderPaymentImage(details: PaymentDetails): Promise<string> {
  details = validatePayment(details);
  if (isExpired(details)) throw new Error('This payment QR has expired. Create a new one to continue.');
  const logo = await loadLogo();
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, buildPayload(details), {
    errorCorrectionLevel: 'H', scale: 10, margin: 4,
    color: { dark: '#74166D', light: '#FFFFFF' },
  });
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  // Square so gallery thumbnails do not crop away the recipient or amount.
  canvas.height = 1000;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser does not support QR image generation.');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, 120, 0, 760, 760);
  // Real stacked PayNow mark artwork, not typeset text.
  // Keep padding and size fixed, with decode tests on the finished composition.
  const logoWidth = 280;
  const logoHeight = logoWidth * logo.height / logo.width;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(500 - logoWidth / 2 - 8, 380 - logoHeight / 2 - 8, logoWidth + 16, logoHeight + 16);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(logo, 500 - logoWidth / 2, 380 - logoHeight / 2, logoWidth, logoHeight);
  // Only print what is set: no amount, reference or expiry means no line for it.
  // Each line knows its gap from the previous one; the block is then centred in
  // the space under the QR code (a full block sits at baselines 790 to 966).
  type Piece = { text: string; font: string; color: string };
  const lines: { pieces: Piece[]; advance: number; ascent: number; descent: number }[] = [];
  const add = (pieces: Piece[], ascent: number, descent: number, gap: number) =>
    lines.push({ pieces, ascent, descent, advance: lines.length ? lines[lines.length - 1]!.descent + gap + ascent : 0 });
  add([{ text: `Pay ${formatRecipient(details)}`, font: '700 70px Arial, sans-serif', color: '#37123D' }], 52, 14, 14);
  if (details.amount) add([{ text: `S$${details.amount}`, font: '800 96px Arial, sans-serif', color: '#37123D' }], 70, 8, 14);
  if (details.reference) add([{ text: `Reference: ${details.reference}`, font: '30px Arial, sans-serif', color: '#6C6070' }], 22, 7, 12);
  // Last line: "Expires ... SGT · by Paynowlah.sg", or just the credit when there is no expiry.
  // The credit copies the site logo: dark "Paynow", pink "lah", regular weight for readability.
  const last: Piece[] = [];
  if (details.expires) {
    last.push({ text: `Expires ${new Date(details.expires).toLocaleString('en-SG', {
      timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })} SGT · `, font: '26px Arial, sans-serif', color: '#6C6070' });
  }
  const small = '26px Arial, sans-serif';
  last.push(
    { text: 'by ', font: small, color: '#6C6070' },
    { text: 'Paynow', font: small, color: '#37123D' },
    { text: 'lah', font: small, color: '#E9208E' },
    { text: '.sg', font: small, color: '#37123D' },
  );
  add(last, 19, 6, 10);

  const height = lines.reduce((sum, l) => sum + l.advance, 0) + lines[0]!.ascent + lines[lines.length - 1]!.descent;
  let y = 856 - height / 2 + lines[0]!.ascent;
  ctx.textAlign = 'left';
  for (const line of lines) {
    y += line.advance;
    // Pieces are drawn one by one (so the credit can be coloured) and centred as a whole.
    const widths = line.pieces.map(p => { ctx.font = p.font; return ctx.measureText(p.text).width; });
    const total = widths.reduce((a, b) => a + b, 0);
    const squeeze = Math.min(1, 900 / total);
    let x = 500 - (total * squeeze) / 2;
    line.pieces.forEach((p, i) => {
      ctx.font = p.font; ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, y, widths[i]! * squeeze);
      x += widths[i]! * squeeze;
    });
  }
  return canvas.toDataURL('image/png');
}
