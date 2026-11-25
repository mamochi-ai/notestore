// In-memory app state + persistence to IndexedDB.
// "local" = owner's editable shop. "readonly" = shared link / sample / published ZIP:
// nothing is ever written to the owner's storage in readonly mode.

import * as db from './db.js';
import { uid } from './util.js';

export const UNSORTED = 'unsorted';

export const S = {
  mode: 'local',          // 'local' | 'readonly'
  source: null,           // 'local' | 'sample' | 'link' | 'published'
  shop: null,
  articles: new Map(),
  books: new Map(),
  images: new Map(),      // id -> {id, blob?, w, h, mime, url?}
  saveState: 'idle',      // 'idle' | 'saving' | 'saved' | 'error'
  saveError: null,
};

const listeners = new Set();
export function onSaveState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emitSave(state, err = null) {
  S.saveState = state; S.saveError = err;
  for (const fn of listeners) fn(state, err);
}

export function defaultShop() {
  return {
    key: 'shop', schema: 1,
    name: 'わたしの小さな本屋',
    tagline: '書いてきたことが、一冊ずつ並ぶ場所。',
    owner: '', intro: '', profileUrl: '', avatarImageId: null,
    theme: 'warm',
    featured: [], featuredPop: 'まず読んでほしい3冊',
    shelves: [{ id: UNSORTED, name: '未分類' }],
    // individuality (added later; old data gets these defaults)
    signFont: 'mincho',            // 看板・棚札の書体: mincho | boldmincho | maru | gothic
    seal: { text: '', show: true }, // 店主の印（text が空なら店主名から自動）
    weathering: true,               // 日焼け（古い本ほど背が褪せる）
    thickness: 'design',            // 本の厚み: design（演出） | length（本文の文字数）
    monthly: null,                  // 今月の一冊 {bookId, month:'YYYY-MM', note}
    lighting: 'auto',               // 店の明かり: auto（見ている人の時刻で朝・昼・夕方・夜） | off（いつも昼）
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

export function newBook(fields) {
  return {
    id: uid('b'), title: '', spineTitle: null, articleIds: [],
    kind: 'single', mode: 'post', writing: 'horizontal',
    shelfId: UNSORTED, order: Date.now(), face: 'spine',
    hidden: false, mergedInto: null, seriesStatus: null,
    pop: '', popOnShelf: true, blurb: '', forWhom: '', shareBody: false, paywall: {},
    obi: { text: '', color: null }, volumes: 0,
    design: {
      color: null, material: null, motif: null,
      coverImageId: undefined, coverPos: { x: 50, y: 50, s: 1 },
      spineImageId: null, spinePos: { x: 50, y: 50, s: 1 },
      showTitle: true, showAuthor: true, titleColor: null,
      titleAlign: 'top', titleWriting: 'horizontal', spineStyle: null,
    },
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

export function hasLocalData() {
  return db.get('meta', 'shop').then((s) => !!s).catch(() => false);
}

export async function loadLocal() {
  const [metas, arts, books, imgs] = await Promise.all([
    db.getAll('meta'), db.getAll('articles'), db.getAll('books'), db.getAll('images'),
  ]);
  const shop = metas.find((m) => m.key === 'shop');
  resetState('local', 'local');
  S.shop = shop ? migrateShop(shop) : null;
  for (const a of arts) S.articles.set(a.id, a);
  for (const b of books) S.books.set(b.id, migrateBook(b));
  for (const i of imgs) S.images.set(i.id, i);
  return !!shop;
}

function migrateShop(s) {
  const d = defaultShop();
  const out = { ...d, ...s };
  if (!out.shelves.some((x) => x.id === UNSORTED)) out.shelves.push({ id: UNSORTED, name: '未分類' });
  return out;
}
function migrateBook(b) {
  const d = newBook({});
  return { ...d, ...b, design: { ...d.design, ...(b.design || {}) } };
}

export function resetState(mode, source) {
  for (const img of S.images.values()) if (img.url && img.blob) URL.revokeObjectURL(img.url);
  S.mode = mode; S.source = source;
  S.shop = null; S.articles = new Map(); S.books = new Map(); S.images = new Map();
}

/** Load readonly data (sample / shared link / published) without touching storage. */
export function loadReadonly(source, { shop, articles = [], books = [], images = [] }) {
  resetState('readonly', source);
  S.shop = migrateShop(shop);
  for (const a of articles) S.articles.set(a.id, a);
  for (const b of books) S.books.set(b.id, migrateBook(b));
  for (const i of images) S.images.set(i.id, i);
}

// ---------- persistence ----------
async function persist(ops) {
  if (S.mode !== 'local') return true; // readonly views never write
  emitSave('saving');
  try {
    await db.write(ops);
    emitSave('saved');
    return true;
  } catch (e) {
    console.error(e);
    emitSave('error', e);
    throw e;
  }
}

export function saveShop() {
  S.shop.updatedAt = new Date().toISOString();
  return persist({ put: { meta: [S.shop] } });
}
export function saveBooks(books) {
  for (const b of books) S.books.set(b.id, b);
  return persist({ put: { books } });
}
export function deleteBooks(ids) {
  for (const id of ids) S.books.delete(id);
  S.shop.featured = S.shop.featured.filter((id) => !ids.includes(id));
  return persist({ del: { books: ids }, put: { meta: [S.shop] } });
}
export function saveAll({ shop = true, books = [], articles = [], images = [], delBooks = [], delArticles = [], delImages = [] } = {}) {
  for (const b of books) S.books.set(b.id, b);
  for (const a of articles) S.articles.set(a.id, a);
  for (const i of images) S.images.set(i.id, i);
  for (const id of delBooks) S.books.delete(id);
  for (const id of delArticles) S.articles.delete(id);
  for (const id of delImages) dropImage(id);
  const put = {};
  if (shop) { S.shop.updatedAt = new Date().toISOString(); put.meta = [S.shop]; }
  if (books.length) put.books = books;
  if (articles.length) put.articles = articles;
  if (images.length) put.images = images.map(stripUrl);
  return persist({ put, del: { books: delBooks, articles: delArticles, images: delImages } });
}
function stripUrl(i) { const { url, ...rest } = i; return rest; }
function dropImage(id) {
  const i = S.images.get(id);
  if (i && i.url && i.blob) URL.revokeObjectURL(i.url);
  S.images.delete(id);
}

export async function replaceAll({ shop, articles, books, images }) {
  const ops = {
    clear: db.STORES,
    put: { meta: [shop], articles, books, images: images.map(stripUrl) },
  };
  emitSave('saving');
  try { await db.write(ops); emitSave('saved'); }
  catch (e) { emitSave('error', e); throw e; }
  await loadLocal();
}

export async function wipeAll() {
  await db.write({ clear: db.STORES });
  resetState('local', 'local');
}

// ---------- images ----------
export function imageUrl(id) {
  if (!id) return null;
  const img = S.images.get(id);
  if (!img) return null;
  if (!img.url && img.blob) img.url = URL.createObjectURL(img.blob);
  return img.url || null;
}

/** Images actually referenced by books/articles/shop (for cleanup & export). */
export function referencedImageIds() {
  const set = new Set();
  if (S.shop && S.shop.avatarImageId) set.add(S.shop.avatarImageId);
  for (const b of S.books.values()) {
    if (b.design.coverImageId) set.add(b.design.coverImageId);
    if (b.design.spineImageId) set.add(b.design.spineImageId);
  }
  for (const a of S.articles.values()) {
    if (a.headImageId) set.add(a.headImageId);
    for (const im of a.images || []) { if (im.imageId) set.add(im.imageId); for (const c of im.candidates || []) set.add(c); }
  }
  return set;
}

// ---------- derived helpers ----------
export function visibleBooks() {
  return [...S.books.values()].filter((b) => !b.hidden);
}
export function booksOnShelf(shelfId) {
  return visibleBooks().filter((b) => (shelfExists(b.shelfId) ? b.shelfId : UNSORTED) === shelfId).sort(byOrder);
}
export function shelfExists(id) { return S.shop.shelves.some((s) => s.id === id); }
export const byOrder = (a, b) => (a.order - b.order) || a.id.localeCompare(b.id);

export function bookArticles(b) {
  return b.articleIds.map((id) => S.articles.get(id)).filter(Boolean);
}
/** Cover image id: explicit custom > (auto) header image of first chapter > none. */
export function coverImageId(b) {
  if (b.design.coverImageId === null) return null;
  if (b.design.coverImageId) return S.images.has(b.design.coverImageId) ? b.design.coverImageId : null;
  const a = bookArticles(b)[0];
  return a && a.headImageId && S.images.has(a.headImageId) ? a.headImageId : null;
}
/** Book's note URL = first chapter's real URL from the export (never guessed). */
export function bookUrl(b) {
  const a = bookArticles(b)[0];
  return a && a.url ? a.url : (b.url || null);
}
/** Publication status across chapters: 'publish' only if every chapter is published. */
export function bookStatus(b) {
  const arts = bookArticles(b);
  if (!arts.length) return b.status || 'unknown';
  if (arts.every((a) => a.status === 'publish' && a.url)) return 'publish';
  if (arts.some((a) => a.status === 'draft')) return 'draft';
  if (arts.some((a) => a.status === 'future')) return 'future';
  return 'unknown';
}
export const STATUS_LABEL = { publish: '公開', draft: '下書き', future: '予約', private: '非公開', unknown: '要確認', sample: 'サンプル' };
