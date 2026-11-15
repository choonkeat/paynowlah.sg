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
  ctx.fillStyle = '#F5EFF7';
  ctx.fillRect(24, 720, 952, 256);
  ctx.fillStyle = '#37123D';
  ctx.font = '700 70px Arial, sans-serif';
  ctx.fillText(formatRecipient(details), 500, 790, 900);
  ctx.font = '800 96px Arial, sans-serif';
  ctx.fillText(details.amount ? `S$${details.amount}` : 'Any amount · SGD', 500, 888, 900);
  ctx.font = '30px Arial, sans-serif';
  ctx.fillStyle = '#6C6070';
  if (details.reference) ctx.fillText(`Reference: ${details.reference}`, 500, 930, 900);
  if (details.expires) {
    ctx.font = '22px Arial, sans-serif';
    ctx.fillText(`Expires ${new Date(details.expires).toLocaleString('en-SG', {
      timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })} SGT`, 500, 966, 900);
  }
  return canvas.toDataURL('image/png');
}
