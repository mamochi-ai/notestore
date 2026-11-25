// Image intake with limits: dimensions are read from the file header BEFORE decoding,
// oversized images are rejected, and large ones are downscaled for storage.
import { uid } from './util.js';

export const MAX_PIXELS = 60_000_000;     // refuse to decode above this
export const MAX_SIDE = 20000;
export const STORE_SIDE = 1600;           // stored long side
export const MAX_FILE = 40 * 1024 * 1024;

/** Detect type + dimensions from bytes. Returns {mime,w,h} or null. */
export function sniffImage(u8) {
  if (!u8 || u8.length < 24) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // PNG
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    return { mime: 'image/png', w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  // GIF
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) {
    return { mime: 'image/gif', w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
  }
  // WEBP
  if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) {
    const fmt = String.fromCharCode(u8[12], u8[13], u8[14], u8[15]);
    if (fmt === 'VP8X') return { mime: 'image/webp', w: 1 + (u8[24] | (u8[25] << 8) | (u8[26] << 16)), h: 1 + (u8[27] | (u8[28] << 8) | (u8[29] << 16)) };
    if (fmt === 'VP8L') { const b = dv.getUint32(21, true); return { mime: 'image/webp', w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    if (fmt === 'VP8 ') return { mime: 'image/webp', w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
    return { mime: 'image/webp', w: 0, h: 0 };
  }
  // JPEG: walk segments to SOFn
  if (u8[0] === 0xff && u8[1] === 0xd8) {
    let i = 2;
    while (i + 9 < u8.length) {
      if (u8[i] !== 0xff) { i++; continue; }
      const m = u8[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = dv.getUint16(i + 2);
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { mime: 'image/jpeg', h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
      }
      i += 2 + len;
    }
    return { mime: 'image/jpeg', w: 0, h: 0 };
  }
  return null;
}

export class ImageRejected extends Error {}

/**
 * Validate + normalize an image. Returns a storable record {id, blob, w, h, mime, origin, name}.
 * Throws ImageRejected with a user-facing reason.
 */
export async function intakeImage(u8, { origin = 'zip', name = '', maxSide = STORE_SIDE } = {}) {
  if (u8.length > MAX_FILE) throw new ImageRejected('画像のファイルサイズが大きすぎます');
  const info = sniffImage(u8);
  if (!info) throw new ImageRejected('対応していない画像形式です');
  if (info.w > MAX_SIDE || info.h > MAX_SIDE || info.w * info.h > MAX_PIXELS) throw new ImageRejected(`画像のピクセル数が大きすぎます（${info.w}×${info.h}）`);
  const blob = new Blob([u8], { type: info.mime });
  let w = info.w, h = info.h;
  const small = u8.length <= 700 * 1024 && w && h && Math.max(w, h) <= maxSide;
  if (small) return { id: uid('img'), blob, w, h, mime: info.mime, origin, name: name.slice(0, 200) };
  // decode and downscale
  let bmp;
  try { bmp = await createImageBitmap(blob); }
  catch { throw new ImageRejected('画像を読み込めませんでした（壊れているか未対応の形式です）'); }
  w = bmp.width; h = bmp.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const c = canvas.getContext('2d');
  c.fillStyle = '#ffffff';
  if (info.mime === 'image/jpeg') c.fillRect(0, 0, cw, ch);
  c.drawImage(bmp, 0, 0, cw, ch);
  if (bmp.close) bmp.close();
  const keepAlpha = info.mime === 'image/png' || info.mime === 'image/webp' || info.mime === 'image/gif';
  let out = await new Promise((r) => canvas.toBlob(r, keepAlpha ? 'image/png' : 'image/jpeg', 0.86));
  if (keepAlpha && out && out.size > 900 * 1024) {
    // large PNGs (e.g. screenshots) → JPEG on white
    c.globalCompositeOperation = 'destination-over'; c.fillStyle = '#fff'; c.fillRect(0, 0, cw, ch);
    out = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  }
  canvas.width = canvas.height = 0;
  if (!out) throw new ImageRejected('画像を変換できませんでした（メモリ不足の可能性があります）');
  return { id: uid('img'), blob: out, w: cw, h: ch, mime: out.type, origin, name: name.slice(0, 200) };
}

/** From a user-picked File. */
export async function intakeFile(file, opt = {}) {
  if (file.size > MAX_FILE) throw new ImageRejected('画像のファイルサイズが大きすぎます（40MBまで）');
  const u8 = new Uint8Array(await file.arrayBuffer());
  return intakeImage(u8, { origin: 'upload', name: file.name, ...opt });
}

export function extFor(mime) {
  return { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[mime] || 'bin';
}
