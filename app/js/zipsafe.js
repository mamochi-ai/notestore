// ZIP reading with safety limits (entry count, sizes, path traversal).
import { unzipSync } from '../vendor/fflate.js';

export const LIMITS = {
  zipBytes: 600 * 1024 * 1024,
  entries: 20000,
  totalBytes: 1200 * 1024 * 1024,
  xmlBytes: 150 * 1024 * 1024,
  imageBytes: 40 * 1024 * 1024,
  jsonBytes: 200 * 1024 * 1024,
};

export class ZipError extends Error {}

/** Normalize an entry name; returns null for unsafe names (absolute, .., backslash, NUL, drive). */
export function safeEntryName(name) {
  if (typeof name !== 'string' || !name || name.length > 1024) return null;
  if (/[\0]/.test(name) || name.includes('\\') || /^[a-zA-Z]:/.test(name) || name.startsWith('/')) return null;
  const parts = name.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  return parts.join('/');
}

export function isZip(u8) {
  return u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && (u8[2] === 0x03 || u8[2] === 0x05) ;
}

/** List entries without inflating. */
export function listZip(u8) {
  if (u8.length > LIMITS.zipBytes) throw new ZipError(`ZIPが大きすぎます（${Math.round(LIMITS.zipBytes / 1048576)}MBまで）。`);
  const entries = [];
  let unsafe = 0, total = 0;
  try {
    unzipSync(u8, {
      filter(f) {
        if (entries.length + unsafe > LIMITS.entries) throw new ZipError(`ZIP内のファイル数が多すぎます（${LIMITS.entries}件まで）。`);
        if (f.name.endsWith('/')) return false;
        const safe = safeEntryName(f.name);
        if (!safe) { unsafe++; return false; }
        total += f.originalSize;
        if (total > LIMITS.totalBytes) throw new ZipError('ZIPを展開すると大きすぎます。');
        entries.push({ name: safe, raw: f.name, size: f.size, originalSize: f.originalSize });
        return false;
      },
    });
  } catch (e) {
    if (e instanceof ZipError) throw e;
    throw new ZipError('ZIPファイルを読み取れませんでした。壊れているか、ZIP形式ではない可能性があります。');
  }
  return { entries, unsafe };
}

/** Inflate selected entries (by raw name). Returns Map(safeName -> Uint8Array). */
export function extract(u8, entries, maxEach) {
  const want = new Map(entries.map((e) => [e.raw, e]));
  const out = new Map();
  let res;
  try {
    res = unzipSync(u8, {
      filter(f) {
        const e = want.get(f.name);
        if (!e) return false;
        if (f.originalSize > maxEach) return false;
        return true;
      },
    });
  } catch (e) {
    throw new ZipError('ZIP内のファイルを展開できませんでした（壊れている可能性があります）。');
  }
  for (const [raw, data] of Object.entries(res)) {
    const e = want.get(raw);
    if (e && data.length <= maxEach) out.set(e.name, data);
  }
  return out;
}
