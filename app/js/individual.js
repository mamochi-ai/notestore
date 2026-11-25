// "Only this shop looks like this": features driven by the owner's own words and own writing.
// 帯 / 平積み・立てかけ / 日焼け / 本文の文字数による厚み / 分冊 / 看板の書体 / 店主の印 / 今月の一冊
import { h, clamp } from './util.js';
import { S, bookArticles, visibleBooks } from './state.js';
import { textChars } from './readtime.js';
import { luminance } from './themes.js';

// ---------- faces ----------
export const FACES = [['spine', '背表紙'], ['cover', '表紙'], ['flat', '平積み'], ['lean', '立てかけ']];
export const faceOf = (b) => (['cover', 'flat', 'lean'].includes(b.face) ? b.face : 'spine');

// ---------- obi (帯) ----------
export const OBI_COLORS = [['#f3ead2', 'クリーム'], ['#c8452f', '朱'], ['#1f1d1b', '墨'], ['#fbfaf6', '白'], ['#2d4a6b', '藍'], ['#6f8a4e', '若草'], ['#d9a93c', '山吹']];
export function obiOf(b) {
  const o = b.obi || {};
  const text = (o.text || '').trim();
  if (!text) return null;
  const color = /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : OBI_COLORS[0][0];
  return { text, color, ink: luminance(color) > 0.35 ? '#2b241d' : '#fbf6ea' };
}

// ---------- weathering (日焼け) ----------
// Relative to this shop: the oldest book is the most faded, the newest not at all.
// The longer someone has been writing, the stronger the oldest fade (max 0.32).
let fadeCtx = null;
export function bookDate(b) {
  const a = bookArticles(b)[0];
  const d = (a && a.date) || b.date || null;
  const t = d ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? t : null;
}
export function prepareFade() {
  if (!S.shop || S.shop.weathering === false) { fadeCtx = null; return; }
  const ts = visibleBooks().map(bookDate).filter((t) => t != null);
  if (ts.length < 2) { fadeCtx = null; return; }
  const min = Math.min(...ts), max = Math.max(...ts);
  const spanDays = (max - min) / 86400000;
  if (spanDays < 7) { fadeCtx = null; return; }
  fadeCtx = { min, max, strength: clamp(0.14 + (spanDays / 730) * 0.18, 0.14, 0.32) };
}
export function fadeOf(b) {
  if (!fadeCtx) return 0;
  const t = bookDate(b);
  if (t == null) return 0;
  return fadeCtx.strength * (fadeCtx.max - t) / (fadeCtx.max - fadeCtx.min);
}
/** CSS filter string for a faded book face (combined with the 'worn' material base). */
export function fadeFilter(f, worn) {
  const parts = [];
  if (worn) parts.push('saturate(.72) contrast(.96)');
  if (f > 0.005) parts.push(`saturate(${(1 - f * 1.7).toFixed(3)}) sepia(${(f * 0.55).toFixed(3)}) brightness(${(1 + f * 0.28).toFixed(3)})`);
  return parts.join(' ');
}

// ---------- thickness from real length ----------
export function bookChars(b) {
  if (Number.isFinite(b.chars) && b.chars > 0) return b.chars; // shared copies carry the count
  return bookArticles(b).reduce((n, a) => n + textChars(a), 0);
}
/** Spine thickness (px) from body length; null when unknown → fall back to the design thickness. */
export function lengthThickness(b, ht) {
  if (!S.shop || S.shop.thickness !== 'length') return null;
  const n = bookChars(b);
  if (!n) return null;
  return clamp(30 + Math.sqrt(n) * 0.36 * (ht / 220), 32, 84);
}

// ---------- volumes (分冊) ----------
const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export function volumeLabels(n) {
  if (n === 2) return ['上', '下'];
  if (n === 3) return ['上', '中', '下'];
  return Array.from({ length: n }, (_, i) => KANJI[i] || String(i + 1));
}
/** [{label, articleIds}] — chapters split as evenly as possible, keeping order. */
export function volumesOf(b) {
  const ids = b.articleIds || [];
  const n = Math.min(b.volumes || 0, ids.length);
  if (b.kind === 'single' || n < 2) return null;
  const labels = volumeLabels(n);
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const size = Math.floor(ids.length / n) + (i < ids.length % n ? 1 : 0);
    out.push({ label: labels[i], index: i, articleIds: ids.slice(k, k + size) });
    k += size;
  }
  return out;
}

// ---------- sign font ----------
export const SIGN_FONTS = [['mincho', '明朝'], ['boldmincho', '太明朝'], ['maru', '丸ゴシック'], ['gothic', '角ゴシック（看板風）']];
export function applySignFont(root = document.documentElement) {
  root.dataset.sign = (S.shop && SIGN_FONTS.some(([k]) => k === S.shop.signFont)) ? S.shop.signFont : 'mincho';
}

// ---------- owner's seal (店主の印) ----------
export function sealText(shop = S.shop) {
  if (!shop) return '';
  const manual = (shop.seal && shop.seal.text || '').trim();
  const src = manual || (shop.owner || '').split(/[@＠|｜/／(（]/)[0];
  const chars = Array.from(src.replace(/[\s\p{P}\p{S}]/gu, ''));
  return chars.slice(0, 4).join('');
}
export function sealEl(size = 44, shop = S.shop) {
  if (!shop || (shop.seal && shop.seal.show === false)) return null;
  const t = sealText(shop);
  if (!t) return null;
  const n = Array.from(t).length;
  const el = h('span', { class: `seal n${n}`, role: 'img', 'aria-label': `店主の印「${t}」` }, h('span', { class: 'seal-t', 'aria-hidden': 'true' }, t));
  el.style.width = el.style.height = size + 'px';
  el.style.fontSize = (n <= 1 ? size * 0.62 : n === 2 ? size * 0.4 : size * 0.36) + 'px';
  return el;
}

// ---------- monthly pick (今月の一冊) ----------
export const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export function monthLabel(m) {
  const r = /^(\d{4})-(\d{2})$/.exec(m || '');
  return r ? `${r[1]}年${parseInt(r[2], 10)}月` : '';
}
export function monthlyPick() {
  const m = S.shop && S.shop.monthly;
  if (!m || !m.bookId) return null;
  const b = S.books.get(m.bookId);
  if (!b || b.hidden) return null;
  return { book: b, month: m.month, note: m.note || '', current: m.month === thisMonth() };
}

// ---------- validation of untrusted copies (backup / shared link / published ZIP) ----------
const cstr = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n) : '');
export function cleanShopExtras(s, bookIds) {
  s = s || {};
  const m = s.monthly;
  return {
    signFont: SIGN_FONTS.some(([k]) => k === s.signFont) ? s.signFont : 'mincho',
    seal: { text: cstr(s.seal && s.seal.text, 4), show: !(s.seal && s.seal.show === false) },
    weathering: s.weathering !== false,
    thickness: s.thickness === 'length' ? 'length' : 'design',
    monthly: m && typeof m === 'object' && bookIds.has(m.bookId) && /^\d{4}-\d{2}$/.test(m.month || '') ? { bookId: m.bookId, month: m.month, note: cstr(m.note, 120) } : null,
  };
}
export function cleanBookExtras(o) {
  o = o || {};
  const obi = o.obi && typeof o.obi === 'object' ? o.obi : {};
  return {
    face: ['cover', 'flat', 'lean'].includes(o.face) ? o.face : 'spine',
    obi: { text: cstr(obi.text, 30), color: /^#[0-9a-f]{6}$/i.test(obi.color || '') ? obi.color : null },
    volumes: Number.isInteger(o.volumes) && o.volumes >= 2 && o.volumes <= 10 ? o.volumes : 0,
    ...(Number.isFinite(o.chars) && o.chars > 0 ? { chars: Math.min(Math.round(o.chars), 5_000_000) } : {}),
    ...(typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(o.date) ? { date: o.date.slice(0, 10) } : {}),
  };
}
