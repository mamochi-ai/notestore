// Small shared helpers. No external dependencies.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Element builder. h('div', {class:'x', onclick:fn}, child, 'text')
 * Text children are always inserted as text nodes (never parsed as HTML).
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') throw new Error('raw html not allowed in h()');
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  appendChildren(el, children);
  return el;
}
function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** SVG element builder (for icons / motifs). */
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.appendChild(c);
  return el;
}

/** FNV-1a 32bit — stable across sessions, used for book colors/heights. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** Stable pseudo random in [0,1) from a key. */
export function rand01(key) {
  let x = hash32(key) || 1;
  x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
  return (x % 100000) / 100000;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function uid(prefix = 'id') {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${r[0].toString(36)}${r[1].toString(36)}`;
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** Count visual "units" of a string: CJK = 1, ASCII ≈ 0.55. Used for spine fitting. */
export function textUnits(s) {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    n += c < 0x2e80 ? (c < 0x80 ? 0.58 : 1) : 1;
  }
  return n;
}
/** Truncate a string to N visual units with an ellipsis. */
export function truncateUnits(s, max) {
  if (textUnits(s) <= max) return s;
  let n = 0, out = '';
  for (const ch of s) {
    const u = textUnits(ch);
    if (n + u > max - 1) break;
    n += u; out += ch;
  }
  return out + '…';
}

let toastTimer;
export function toast(msg, kind = 'info', ms = 3200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Allow only http(s) URLs. Returns normalized string or null. */
export function safeHttpUrl(u, { httpsOnly = false } = {}) {
  if (typeof u !== 'string' || u.length > 2048) return null;
  try {
    const url = new URL(u.trim());
    if (url.protocol !== 'https:' && (httpsOnly || url.protocol !== 'http:')) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
/** note.com article/profile URL check (used for shared links). */
export function isNoteUrl(u) {
  const s = safeHttpUrl(u, { httpsOnly: true });
  if (!s) return false;
  const host = new URL(s).hostname;
  return host === 'note.com' || host.endsWith('.note.com') || host === 'note.mu';
}

export function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Share a file via the iOS share sheet when possible; otherwise download. */
export async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export const sleepFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
