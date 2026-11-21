// note export (WordPress WXR 1.2 style XML, optionally in a ZIP with assets/) → articles.
// Verified against one real note export (WXR 1.2, <guid> = note key, images at /assets/{key}_*.png).
// Anything else is handled defensively and reported, not silently "supported".

import { hash32, safeHttpUrl } from './util.js';
import { sanitizeHtml } from './sanitize.js';
import { intakeImage, ImageRejected } from './images.js';
import { isZip, listZip, extract, LIMITS, ZipError } from './zipsafe.js';

export class ImportError extends Error {}

const NS = {
  wp: ['http://wordpress.org/export/1.2/', 'http://wordpress.org/export/1.1/', 'http://wordpress.org/export/1.0/'],
  content: ['http://purl.org/rss/1.0/modules/content/'],
  dc: ['http://purl.org/dc/elements/1.1/'],
  excerpt: ['http://wordpress.org/export/1.2/excerpt/', 'http://wordpress.org/export/1.1/excerpt/'],
};
const IMG_EXT = /\.(png|jpe?g|gif|webp)$/i;

// ---------- XML ----------
export function parseWxr(text) {
  if (typeof text !== 'string' || !text.trim()) throw new ImportError('XMLファイルが空です。');
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) throw new ImportError('安全のため、DOCTYPE / ENTITY 宣言を含むXMLは読み込めません。');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ImportError('XMLの形式が正しくありません（途中で切れているか、壊れている可能性があります）。');
  const rss = doc.documentElement;
  const channel = rss.getElementsByTagName('channel')[0];
  if (!channel) throw new ImportError('noteのエクスポート形式（RSS / WXR）として認識できませんでした。');
  const nsOf = (prefix) => {
    const declared = rss.lookupNamespaceURI(prefix);
    return declared ? [declared, ...NS[prefix]] : NS[prefix];
  };
  const wp = nsOf('wp'), content = nsOf('content'), dc = nsOf('dc'), ex = nsOf('excerpt');
  const childText = (el, uris, local) => {
    for (const u of uris) {
      for (const c of Array.from(el.children)) if (c.namespaceURI === u && c.localName === local) return c.textContent || '';
    }
    return '';
  };
  const plain = (el, local) => { for (const c of Array.from(el.children)) if (!c.namespaceURI && c.localName === local) return c.textContent || ''; return ''; };

  const ch = {
    title: plain(channel, 'title').trim(),
    link: plain(channel, 'link').trim(),
    description: plain(channel, 'description').trim(),
    generator: plain(channel, 'generator').trim(),
    wxr: childText(channel, wp, 'wxr_version').trim(),
  };
  const items = Array.from(channel.children).filter((c) => !c.namespaceURI && c.localName === 'item').map((it) => ({
    title: plain(it, 'title').trim(),
    link: plain(it, 'link').trim(),
    guid: plain(it, 'guid').trim(),
    pubDate: plain(it, 'pubDate').trim(),
    creator: childText(it, dc, 'creator').trim(),
    content: childText(it, content, 'encoded'),
    excerpt: childText(it, ex, 'encoded'),
    postId: childText(it, wp, 'post_id').trim(),
    postDate: childText(it, wp, 'post_date').trim(),
    postDateGmt: childText(it, wp, 'post_date_gmt').trim(),
    modified: childText(it, wp, 'post_modified').trim(),
    status: childText(it, wp, 'status').trim(),
    postType: childText(it, wp, 'post_type').trim(),
  }));
  return { channel: ch, items };
}

function toIso(local, gmt) {
  // wp:post_date is local (note = JST); prefer gmt if present
  const g = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(gmt) && !gmt.startsWith('0000') ? gmt.replace(' ', 'T') + 'Z' : null;
  if (g && !isNaN(new Date(g))) return new Date(g).toISOString();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(local)) { const d = new Date(local.replace(' ', 'T') + '+09:00'); if (!isNaN(d)) return d.toISOString(); }
  return null;
}
const STATUS = { publish: 'publish', draft: 'draft', pending: 'draft', future: 'future', private: 'private' };

export function articleIdFor(it) {
  if (/^n[0-9a-z]{6,20}$/i.test(it.guid)) return 'note_' + it.guid;
  if (it.guid) return 'g_' + hash32(it.guid).toString(36);
  if (it.link) return 'l_' + hash32(it.link).toString(36);
  return 'p_' + hash32(`${it.postId}|${it.title}|${it.postDate}`).toString(36);
}

// ---------- image ref resolution ----------
function normRef(ref) {
  let r = ref.split('#')[0].split('?')[0].trim().replace(/\\/g, '/');
  try { r = decodeURIComponent(r); } catch { /* keep raw */ }
  r = r.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  return r;
}
function baseName(p) { return p.split('/').pop(); }

class AssetIndex {
  constructor(entries) {
    this.byPath = new Map();
    this.byBase = new Map();
    for (const e of entries) {
      if (!IMG_EXT.test(e.name)) continue;
      let n = e.name;
      try { n = decodeURIComponent(n); } catch { /* */ }
      this.byPath.set(n.toLowerCase(), e);
      const b = baseName(n).toLowerCase();
      if (!this.byBase.has(b)) this.byBase.set(b, []);
      this.byBase.get(b).push(e);
    }
  }
  /** → {entry} | {candidates:[entries]} | null */
  resolve(ref) {
    const r = normRef(ref).toLowerCase();
    if (!r) return null;
    if (this.byPath.has(r)) return { entry: this.byPath.get(r) };
    // ZIP may have a top folder (e.g. export/assets/x.png): suffix match
    for (const [p, e] of this.byPath) if (p.endsWith('/' + r)) return { entry: e };
    const list = this.byBase.get(baseName(r)) || [];
    if (list.length === 1) return { entry: list[0] };
    if (list.length > 1) return { candidates: list };
    return null;
  }
}

// ---------- main ----------
/**
 * @param {File} file
 * @param {{progress:(f:number,msg:string)=>void, cancelled:()=>boolean}} cb
 * @returns plan {channel, articles, images:Map(id->record), warnings[], stats}
 */
export async function parseExport(file, cb = {}) {
  const progress = cb.progress || (() => {});
  const cancelled = cb.cancelled || (() => false);
  const check = () => { if (cancelled()) throw new ImportError('キャンセルしました。'); };
  const warnings = [];
  if (file.size > LIMITS.zipBytes) throw new ImportError('ファイルが大きすぎます（600MBまで）。');
  progress(0.02, 'ファイルを読み込んでいます…');
  const u8 = new Uint8Array(await file.arrayBuffer());
  check();

  let xmlTexts = [];
  let assets = new AssetIndex([]);
  let zipEntries = null;
  let kind = 'xml';
  if (isZip(u8)) {
    kind = 'zip';
    progress(0.05, 'ZIPの中身を確認しています…');
    const { entries, unsafe } = listZip(u8);
    if (unsafe) warnings.push(`安全でないパスのファイル ${unsafe} 件を無視しました。`);
    const xmlEntries = entries.filter((e) => /\.xml$/i.test(e.name) && !e.name.split('/').some((p) => p.startsWith('__MACOSX') || p.startsWith('.')));
    if (!xmlEntries.length) throw new ImportError('ZIPの中にXMLファイルが見つかりませんでした。noteで書き出したZIPを選んでください。');
    const big = xmlEntries.filter((e) => e.originalSize > LIMITS.xmlBytes);
    if (big.length) throw new ImportError('XMLファイルが大きすぎます。');
    const files = extract(u8, xmlEntries, LIMITS.xmlBytes);
    xmlEntries.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    for (const e of xmlEntries) { const d = files.get(e.name); if (d) xmlTexts.push({ name: e.name, text: new TextDecoder('utf-8').decode(d) }); }
    assets = new AssetIndex(entries);
    zipEntries = entries;
  } else {
    const head = new TextDecoder('utf-8').decode(u8.subarray(0, 200)).trim();
    if (!head.startsWith('<')) throw new ImportError('ZIPまたはXMLファイルを選んでください。');
    xmlTexts.push({ name: file.name, text: new TextDecoder('utf-8').decode(u8) });
  }
  check();
  progress(0.12, '記事を解析しています…');

  let channel = null;
  const articles = [];
  const seen = new Set();
  const neededEntries = new Map(); // entry.name -> {entry, id}
  const idForEntry = (entry) => {
    if (!neededEntries.has(entry.name)) neededEntries.set(entry.name, { entry, id: 'img_' + hash32(entry.name + ':' + entry.originalSize).toString(36) + hash32(entry.name).toString(36).slice(0, 3) });
    return neededEntries.get(entry.name).id;
  };
  let skippedTypes = 0;
  for (const x of xmlTexts) {
    let parsed;
    try { parsed = parseWxr(x.text); }
    catch (e) { if (xmlTexts.length === 1) throw e; warnings.push(`${x.name}: ${e.message}`); continue; }
    channel = channel || parsed.channel;
    for (const it of parsed.items) {
      if (it.postType && it.postType !== 'post') { skippedTypes++; continue; }
      const id = articleIdFor(it);
      if (seen.has(id)) continue;
      seen.add(id);
      const imgs = [];
      const { html, text } = sanitizeHtml(it.content, {
        resolveImage(ref) {
          const r = assets.resolve(ref);
          if (!r) { imgs.push({ ref, imageId: null, candidates: [] }); return null; }
          if (r.entry) { const iid = idForEntry(r.entry); imgs.push({ ref, imageId: iid, candidates: [], entry: r.entry.name }); return iid; }
          imgs.push({ ref, imageId: null, candidates: r.candidates.map((c) => idForEntry(c)) });
          return null;
        },
      });
      // header image: only when the article STARTS with a figure whose file follows the note
      // eyecatch naming ({key}_{32 hex}.ext) observed in the real export. Never "first image" blindly.
      let headImageId = null, headConfidence = null;
      const first = imgs[0];
      if (first && first.imageId && first.entry && startsWithImage(html)) {
        const b = baseName(first.entry);
        const key = it.guid && it.guid.replace(/[^0-9a-z]/gi, '');
        if (key && new RegExp(`^${key}_[0-9a-f]{32}\\.(png|jpe?g|gif|webp)$`, 'i').test(b)) { headImageId = first.imageId; headConfidence = 'note-eyecatch'; }
      }
      const status = STATUS[it.status] || 'unknown';
      const link = safeHttpUrl(it.link);
      articles.push({
        id, guid: it.guid, title: it.title, html, textLength: text.length,
        date: toIso(it.postDate, it.postDateGmt), modified: toIso(it.modified, ''),
        status, rawStatus: it.status || '',
        url: status === 'publish' && link ? link : null,
        rawLink: link,
        images: imgs.map(({ entry, ...rest }) => rest),
        headImageId, headConfidence,
        contentHash: hash32(it.title + '\u0000' + it.content + '\u0000' + it.status).toString(36),
        source: kind, importedAt: new Date().toISOString(),
      });
    }
    check();
  }
  if (!articles.length && !channel) throw new ImportError('記事が見つかりませんでした。');
  if (skippedTypes) warnings.push(`記事以外の項目 ${skippedTypes} 件は読み込みませんでした。`);
  if (kind === 'xml') {
    const withImgs = articles.filter((a) => a.images.some((i) => !i.ref.startsWith('http'))).length;
    if (withImgs) warnings.push('XML単体のため画像は含まれていません。画像を使うにはZIPのまま読み込んでください（表紙は文字の表紙になります）。');
  }

  // ---- images (batched to bound memory, cancellable) ----
  const images = new Map();
  const list = [...neededEntries.values()];
  let failed = 0;
  const BATCH = 12;
  for (let i = 0; i < list.length; i += BATCH) {
    check();
    const batch = list.slice(i, i + BATCH);
    const data = extract(u8, batch.map((b) => b.entry), LIMITS.imageBytes);
    for (const { entry, id } of batch) {
      const bytes = data.get(entry.name);
      if (!bytes) { failed++; continue; }
      try {
        const rec = await intakeImage(bytes, { origin: 'zip', name: entry.name });
        rec.id = id;
        images.set(id, rec);
      } catch (e) {
        failed++;
        if (!(e instanceof ImageRejected)) console.warn(e);
      }
    }
    progress(0.15 + 0.8 * Math.min(1, (i + BATCH) / list.length), `画像を準備しています… ${Math.min(i + BATCH, list.length)} / ${list.length}`);
  }
  if (failed) warnings.push(`読み込めなかった画像が ${failed} 件あります（大きすぎる・壊れている・未対応の形式）。`);
  // drop references to images that failed
  for (const a of articles) {
    if (a.headImageId && !images.has(a.headImageId)) { a.headImageId = null; a.headConfidence = null; }
    for (const im of a.images) {
      if (im.imageId && !images.has(im.imageId)) im.imageId = null;
      im.candidates = im.candidates.filter((c) => images.has(c));
    }
  }
  const missing = articles.reduce((n, a) => n + a.images.filter((i) => !i.imageId && !i.candidates.length && !/^https?:/i.test(i.ref)).length, 0);
  if (kind === 'zip' && missing) warnings.push(`ZIP内に見つからなかった画像参照が ${missing} 件あります。`);
  const ambiguous = articles.filter((a) => a.images.some((i) => i.candidates.length > 1)).length;
  if (ambiguous) warnings.push(`同じ名前の画像が複数あり特定できなかった記事が ${ambiguous} 件あります。装丁編集で表紙を選んでください。`);
  progress(1, '解析が終わりました');

  const ch = channel || {};
  return {
    kind, warnings,
    channel: { title: ch.title || '', link: safeHttpUrl(ch.link) || '', description: ch.description || '', generator: ch.generator || '', wxr: ch.wxr || '' },
    articles, images,
    stats: {
      total: articles.length,
      publish: articles.filter((a) => a.status === 'publish').length,
      draft: articles.filter((a) => a.status === 'draft').length,
      other: articles.filter((a) => a.status !== 'publish' && a.status !== 'draft').length,
      images: images.size, zipEntries: zipEntries ? zipEntries.length : 0,
    },
  };
}

function startsWithImage(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  const first = t.content.firstElementChild;
  if (!first) return false;
  if (first.tagName === 'IMG') return true;
  return first.tagName === 'FIGURE' && first.firstElementChild && first.firstElementChild.tagName === 'IMG';
}
