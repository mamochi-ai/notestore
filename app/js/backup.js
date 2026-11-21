// Backup ZIP = backup.json (shop, articles, books) + images/*. Restorable on another device.
import { zipSync, strToU8, strFromU8 } from '../vendor/fflate.js';
import { h, toast, shareOrDownload, safeHttpUrl, isNoteUrl } from './util.js';
import { S, defaultShop, newBook, replaceAll, UNSORTED } from './state.js';
import { progressDialog, confirmDialog, alertDialog } from './ui.js';
import { extFor, sniffImage } from './images.js';
import { listZip, extract, isZip, LIMITS } from './zipsafe.js';
import { sanitizeHtml } from './sanitize.js';
import { THEME_MAP } from './themes.js';

const APP = 'little-bookshop';

export async function exportBackup() {
  const pd = progressDialog('バックアップを作っています');
  try {
    const images = [...S.images.values()].filter((i) => i.blob);
    const files = {};
    const meta = [];
    for (let i = 0; i < images.length; i++) {
      if (pd.cancelled) throw new Error('cancel');
      const img = images[i];
      const path = `images/${img.id}.${extFor(img.mime)}`;
      files[path] = [new Uint8Array(await img.blob.arrayBuffer()), { level: 0 }];
      meta.push({ id: img.id, w: img.w, h: img.h, mime: img.mime, origin: img.origin, name: img.name || '', file: path });
      if (i % 10 === 0) pd.set(0.1 + 0.8 * (i / images.length), `画像 ${i + 1} / ${images.length}`);
    }
    const json = {
      app: APP, version: 1, exportedAt: new Date().toISOString(),
      shop: S.shop, articles: [...S.articles.values()], books: [...S.books.values()], images: meta,
    };
    files['backup.json'] = strToU8(JSON.stringify(json));
    files['README.txt'] = strToU8('わたしの小さな本屋のバックアップです。\nアプリの「お店の設定」→「バックアップから復元」でこのZIPを選ぶと元に戻せます。\n記事の本文・画像・設定が含まれます。他の人に渡さないでください。\n');
    pd.set(0.95, 'ZIPにまとめています…');
    const zipped = zipSync(files, { level: 6 });
    pd.close();
    const d = new Date();
    const name = `bookshop-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.zip`;
    const r = await shareOrDownload(new Blob([zipped], { type: 'application/zip' }), name, 'わたしの小さな本屋 バックアップ');
    if (r !== 'cancelled') toast(`バックアップ（${Math.round(zipped.length / 1024)}KB）を書き出しました。「ファイル」アプリなどに保存してください。`, 'info', 6000);
  } catch (e) {
    pd.close();
    if (e.message !== 'cancel') alertDialog(`バックアップを作れませんでした。${e.message || ''}`, 'エラー');
  }
}

export function openRestore(onDone) {
  const input = h('input', { type: 'file', accept: '.zip,application/zip', class: 'visually-hidden' });
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const f = input.files[0];
    input.remove();
    if (!f) return;
    try {
      const data = await readBackup(f);
      const ok = await confirmDialog(`バックアップ（${data.books.length}冊・記事${data.articles.length}件・画像${data.images.length}枚）を復元します。\nこの端末にある現在の本屋のデータは置き換えられます。`, { ok: '復元する', danger: true });
      if (!ok) return;
      await replaceAll(data);
      toast('バックアップから復元しました');
      onDone && onDone();
    } catch (e) {
      console.error(e);
      alertDialog(e.message || '復元できませんでした。', '復元できませんでした');
    }
  });
  input.click();
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(v);

/** Parse + validate a backup ZIP. Never trusts its contents. */
export async function readBackup(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  if (!isZip(u8)) throw new Error('バックアップのZIPファイルを選んでください。');
  const { entries } = listZip(u8);
  const je = entries.find((e) => e.name === 'backup.json');
  if (!je) throw new Error('このZIPはバックアップではないようです（backup.json がありません）。');
  const files = extract(u8, [je], LIMITS.jsonBytes);
  let json;
  try { json = JSON.parse(strFromU8(files.get('backup.json'))); } catch { throw new Error('バックアップの内容が壊れています。'); }
  if (!json || json.app !== APP || json.version !== 1) throw new Error('対応していないバックアップ形式です。');

  // images
  const imgMeta = Array.isArray(json.images) ? json.images.filter((m) => m && isId(m.id) && typeof m.file === 'string').slice(0, 50000) : [];
  const want = entries.filter((e) => imgMeta.some((m) => m.file === e.name));
  const images = [];
  for (let i = 0; i < want.length; i += 30) {
    const got = extract(u8, want.slice(i, i + 30), LIMITS.imageBytes);
    for (const [name, bytes] of got) {
      const m = imgMeta.find((x) => x.file === name);
      const info = sniffImage(bytes);
      if (!m || !info) continue;
      images.push({ id: m.id, blob: new Blob([bytes], { type: info.mime }), w: info.w || m.w, h: info.h || m.h, mime: info.mime, origin: m.origin === 'upload' ? 'upload' : 'zip', name: str(m.name, 200) });
    }
  }
  const imgIds = new Set(images.map((i) => i.id));
  const known = (id) => imgIds.has(id);

  // articles
  const articles = (Array.isArray(json.articles) ? json.articles : []).filter((a) => a && isId(a.id)).map((a) => ({
    id: a.id, guid: str(a.guid, 80), title: str(a.title, 500),
    html: sanitizeHtml(str(a.html, 5_000_000), { knownImage: known }).html,
    textLength: Number(a.textLength) || 0,
    date: str(a.date, 40) || null, modified: str(a.modified, 40) || null,
    status: ['publish', 'draft', 'future', 'private', 'unknown', 'sample'].includes(a.status) ? a.status : 'unknown',
    rawStatus: str(a.rawStatus, 20),
    url: safeHttpUrl(a.url) || null, rawLink: safeHttpUrl(a.rawLink) || null,
    images: (Array.isArray(a.images) ? a.images : []).slice(0, 500).map((im) => ({ ref: str(im && im.ref, 500), imageId: im && known(im.imageId) ? im.imageId : null, candidates: (im && Array.isArray(im.candidates) ? im.candidates : []).filter(known) })),
    headImageId: known(a.headImageId) ? a.headImageId : null, headConfidence: str(a.headConfidence, 40) || null,
    contentHash: str(a.contentHash, 40), source: str(a.source, 20), importedAt: str(a.importedAt, 40),
  }));
  const artIds = new Set(articles.map((a) => a.id));

  // shop
  const s = json.shop || {};
  const shop = defaultShop();
  Object.assign(shop, {
    name: str(s.name, 60) || shop.name, tagline: str(s.tagline, 80), owner: str(s.owner, 60), intro: str(s.intro, 2000),
    profileUrl: isNoteUrl(s.profileUrl) ? s.profileUrl : '', avatarImageId: known(s.avatarImageId) ? s.avatarImageId : null,
    theme: THEME_MAP[s.theme] ? s.theme : 'warm', featuredPop: str(s.featuredPop, 40),
    shelves: (Array.isArray(s.shelves) ? s.shelves : []).filter((x) => x && isId(x.id)).slice(0, 200).map((x) => ({ id: x.id, name: str(x.name, 40) || '名前なし', keywords: (Array.isArray(x.keywords) ? x.keywords : []).map((k) => str(k, 30)).filter(Boolean).slice(0, 20) })),
    createdAt: str(s.createdAt, 40) || shop.createdAt,
  });
  if (!shop.shelves.some((x) => x.id === UNSORTED)) shop.shelves.push({ id: UNSORTED, name: '未分類' });

  // books
  const pos = (p) => ({ x: clampN(p && p.x, 0, 100, 50), y: clampN(p && p.y, 0, 100, 50), s: clampN(p && p.s, 1, 3, 1) });
  const books = (Array.isArray(json.books) ? json.books : []).filter((b) => b && isId(b.id)).map((b) => {
    const d = b.design || {};
    const nb = newBook({
      id: b.id, title: str(b.title, 300) || '無題', spineTitle: str(b.spineTitle, 80) || null,
      articleIds: (Array.isArray(b.articleIds) ? b.articleIds : []).filter((x) => artIds.has(x)),
      kind: ['single', 'serial', 'anthology'].includes(b.kind) ? b.kind : 'single',
      mode: b.mode === 'novel' ? 'novel' : 'post', writing: b.writing === 'vertical' ? 'vertical' : 'horizontal',
      shelfId: isId(b.shelfId) ? b.shelfId : UNSORTED, order: Number(b.order) || 0, face: b.face === 'cover' ? 'cover' : 'spine',
      hidden: !!b.hidden, mergedInto: isId(b.mergedInto) ? b.mergedInto : null,
      seriesStatus: ['ongoing', 'complete'].includes(b.seriesStatus) ? b.seriesStatus : null,
      pop: str(b.pop, 200), popOnShelf: b.popOnShelf !== false, blurb: str(b.blurb, 1000), forWhom: str(b.forWhom, 200), shareBody: !!b.shareBody,
      createdAt: str(b.createdAt, 40),
    });
    Object.assign(nb.design, {
      color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : null,
      material: ['cloth', 'paper', 'leather', 'worn', 'matte'].includes(d.material) ? d.material : null,
      motif: typeof d.motif === 'string' && /^[a-z]{2,12}$/.test(d.motif) ? d.motif : null,
      coverImageId: d.coverImageId === undefined ? undefined : known(d.coverImageId) ? d.coverImageId : null,
      coverPos: pos(d.coverPos), spineImageId: known(d.spineImageId) ? d.spineImageId : null, spinePos: pos(d.spinePos),
      showTitle: d.showTitle !== false, showAuthor: d.showAuthor !== false,
      titleColor: /^#[0-9a-f]{6}$/i.test(d.titleColor) ? d.titleColor : null,
      titleAlign: ['top', 'center', 'bottom'].includes(d.titleAlign) ? d.titleAlign : 'top',
      titleWriting: d.titleWriting === 'vertical' ? 'vertical' : 'horizontal',
      spineStyle: typeof d.spineStyle === 'string' && /^[a-z]{3,8}$/.test(d.spineStyle) ? d.spineStyle : null,
      coverLayout: ['full', 'plate'].includes(d.coverLayout) ? d.coverLayout : null,
    });
    return nb;
  }).filter((b) => b.articleIds.length);
  const bookIds = new Set(books.map((b) => b.id));
  shop.featured = (Array.isArray(s.featured) ? s.featured : []).filter((id) => bookIds.has(id)).slice(0, 3);
  return { shop, articles, books, images };
}
function clampN(v, a, b, d) { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; }
