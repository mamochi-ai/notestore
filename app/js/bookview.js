// Renders books as real DOM (buttons with text), never as baked images.
// Every visual variation (color, height, thickness, motif, spine style) is derived
// from a stable hash of the book id, so the shelf never "reshuffles" between renders.

import { h, svg, rand01, hash32, clamp, textUnits, truncateUnits } from './util.js';
import { inkFor, luminance } from './themes.js';
import { S, coverImageId, imageUrl, bookArticles } from './state.js';
import { obiOf, fadeOf, fadeFilter } from './individual.js';

// ---------- titles ----------
/** Deterministic short title for spines: drops leading 【tag】/emoji and trailing (…) notes. */
export function autoSpineTitle(title) {
  let t = (title || '').trim();
  t = t.replace(/^[\s\p{Extended_Pictographic}️‍]+/u, '');
  for (let i = 0; i < 3; i++) t = t.replace(/^[【［\[][^】］\]]{1,24}[】］\]]\s*/, '');
  t = t.replace(/[（(][^）)]*[）)]\s*$/, '').trim();
  const cut = t.search(/\s*[〜～]|\s[-–—|｜]\s/);
  if (cut >= 4) t = t.slice(0, cut);
  return t.trim() || (title || '').trim() || '無題';
}
export function coverTitle(b) {
  return (b.spineTitle && b.spineTitle.trim()) || autoSpineTitle(b.title);
}
export function spineTitle(b) {
  return (b.spineTitle && b.spineTitle.trim()) || autoSpineTitle(b.title);
}

// ---------- stable look ----------
const SPINE_STYLES = {
  warm: ['plain', 'bands', 'label', 'frame', 'plain', 'bands'],
  library: ['ribs', 'bands', 'frame', 'ribs', 'plain'],
  abandoned: ['plain', 'label', 'bands', 'plain'],
  overseas: ['bands', 'frame', 'label', 'ribs', 'bands'],
  luxury: ['ribs', 'frame', 'bands', 'ribs'],
  future: ['line', 'plain', 'line', 'plain'],
};
export const SPINE_STYLE_NAMES = { plain: '無地', bands: '細い帯', label: '紙ラベル', frame: '枠', ribs: '革の背バンド', line: '光のライン' };
export const MOTIFS = ['hills', 'sprig', 'mountain', 'rain', 'stars', 'wave', 'tablet', 'notebook'];
export const MOTIF_NAMES = { hills: '丘', sprig: '小枝', mountain: '山と湖', rain: '雨', stars: '星', wave: '波', tablet: '端末', notebook: 'ノート', none: 'なし' };
const MARKS = ['leaf', 'mountain', 'flower', 'drops', 'star', 'wave', 'diamond'];

export function bookLook(b, theme) {
  const pal = theme.books;
  const color = b.design.color || pal[hash32(b.id + theme.id) % pal.length];
  const material = b.design.material || theme.material;
  const styles = SPINE_STYLES[theme.id] || SPINE_STYLES.warm;
  const spineStyle = b.design.spineStyle || styles[hash32(b.id + 's') % styles.length];
  const motif = b.design.motif || MOTIFS[hash32(b.id + 'm') % 6];
  const mark = MARKS[hash32(b.id + 'k') % MARKS.length];
  const ink = b.design.titleColor || inkFor(color, theme);
  // accent colors for illustrated covers: two other palette colors
  const i1 = hash32(b.id + 'a') % pal.length;
  let m1 = pal[i1] === color ? pal[(i1 + 1) % pal.length] : pal[i1];
  let m2 = pal[(i1 + 3) % pal.length];
  if (m2 === color) m2 = pal[(i1 + 4) % pal.length];
  return { color, material, spineStyle, motif, mark, ink, m1, m2, light: luminance(ink) < 0.2 };
}

/** Stable size factors (0..1) for height and thickness. */
export function bookDims(b) {
  return { hf: rand01(b.id + ':h'), wf: rand01(b.id + ':w') };
}

// ---------- SVG art ----------
export function motifSvg(kind, look) {
  const s = (tag, a) => svg(tag, a);
  const g = [];
  const ink = 'var(--ink)';
  switch (kind) {
    case 'hills':
      g.push(s('path', { d: 'M0 72 C18 60 30 66 46 62 C62 58 76 50 100 56 L100 100 L0 100Z', fill: 'var(--m1)', opacity: '.75' }));
      g.push(s('path', { d: 'M0 84 C20 74 40 80 58 76 C74 72 86 70 100 74 L100 100 L0 100Z', fill: 'var(--m2)', opacity: '.8' }));
      g.push(s('path', { d: 'M8 90 C30 84 52 92 78 86', fill: 'none', stroke: ink, 'stroke-width': '.6', opacity: '.35' }));
      break;
    case 'sprig':
      g.push(s('path', { d: 'M50 92 C50 76 48 62 42 46', fill: 'none', stroke: ink, 'stroke-width': '1.1', 'stroke-linecap': 'round' }));
      for (const [x, y, r] of [[47, 76, -40], [49, 66, 35], [45, 58, -45], [46, 50, 30]]) {
        g.push(s('ellipse', { cx: x + (r > 0 ? 6 : -6), cy: y, rx: 6, ry: 2.6, transform: `rotate(${r} ${x} ${y})`, fill: 'var(--m1)', opacity: '.9' }));
      }
      for (const [x, y] of [[38, 44], [41, 40], [36, 39]]) g.push(s('circle', { cx: x, cy: y, r: 1.8, fill: 'var(--m2)' }));
      g.push(s('path', { d: 'M0 94 C30 88 70 98 100 92 L100 100 L0 100Z', fill: 'var(--m2)', opacity: '.5' }));
      break;
    case 'mountain':
      g.push(s('path', { d: 'M0 74 L22 56 L34 64 L54 44 L76 66 L88 58 L100 66 L100 100 L0 100Z', fill: 'var(--m1)', opacity: '.75' }));
      g.push(s('path', { d: 'M0 80 L100 80 L100 100 L0 100Z', fill: 'var(--m2)', opacity: '.55' }));
      g.push(s('path', { d: 'M14 86 H34 M48 90 H70 M24 94 H40', stroke: ink, 'stroke-width': '.6', opacity: '.4' }));
      break;
    case 'rain':
      for (let i = 0; i < 14; i++) {
        const x = (i * 37) % 100, y = 28 + ((i * 23) % 40);
        g.push(s('path', { d: `M${x} ${y} l-3 7`, stroke: ink, 'stroke-width': '.7', opacity: '.45', 'stroke-linecap': 'round' }));
      }
      g.push(s('path', { d: 'M36 78 Q50 62 64 78 Q57 75 50 78 Q43 75 36 78Z', fill: 'var(--m1)', stroke: ink, 'stroke-width': '.6' }));
      g.push(s('path', { d: 'M50 78 V88 q0 3 -3 3', fill: 'none', stroke: ink, 'stroke-width': '.8' }));
      break;
    case 'stars':
      g.push(s('path', { d: 'M62 34 a10 10 0 1 0 8 16 a8 8 0 1 1 -8 -16Z', fill: 'var(--m1)' }));
      for (const [x, y, r] of [[26, 40, 1.4], [34, 58, 1], [72, 66, 1.2], [44, 30, .9], [82, 44, 1], [20, 70, .8]]) g.push(s('circle', { cx: x, cy: y, r, fill: ink, opacity: '.7' }));
      g.push(s('path', { d: 'M0 86 C24 80 40 88 60 84 C78 80 90 82 100 84 L100 100 L0 100Z', fill: 'var(--m2)', opacity: '.6' }));
      break;
    case 'wave':
      g.push(s('path', { d: 'M0 70 Q12 64 25 70 T50 70 T75 70 T100 70 V100 H0Z', fill: 'var(--m1)', opacity: '.7' }));
      g.push(s('path', { d: 'M0 80 Q12 74 25 80 T50 80 T75 80 T100 80 V100 H0Z', fill: 'var(--m2)', opacity: '.75' }));
      g.push(s('circle', { cx: 72, cy: 44, r: 7, fill: 'none', stroke: ink, 'stroke-width': '.8', opacity: '.6' }));
      break;
    case 'tablet':
      g.push(s('path', { d: 'M0 84 C22 76 44 84 64 80 C80 77 92 78 100 80 V100 H0Z', fill: 'var(--m1)', opacity: '.7' }));
      g.push(s('rect', { x: 32, y: 46, width: 36, height: 26, rx: 3, fill: 'none', stroke: ink, 'stroke-width': '1.3', transform: 'rotate(-12 50 59)' }));
      g.push(s('path', { d: 'M30 40 l-3 -4 M36 37 l0 -5 M42 39 l3 -4', stroke: ink, 'stroke-width': '.9', 'stroke-linecap': 'round' }));
      break;
    case 'notebook':
      g.push(s('rect', { x: 34, y: 44, width: 28, height: 34, rx: 2, fill: 'none', stroke: ink, 'stroke-width': '1.1', transform: 'rotate(-8 48 61)' }));
      for (let i = 0; i < 5; i++) g.push(s('circle', { cx: 34 + 0, cy: 48 + i * 6, r: 1.4, fill: 'none', stroke: ink, 'stroke-width': '.7', transform: 'rotate(-8 48 61)' }));
      g.push(s('path', { d: 'M70 46 L62 74 L60 78 L63 75 L71 47Z', fill: 'none', stroke: ink, 'stroke-width': '1' }));
      g.push(s('path', { d: 'M0 88 C30 82 60 92 100 86 V100 H0Z', fill: 'var(--m2)', opacity: '.55' }));
      break;
    default: return null;
  }
  return svg('svg', { class: 'cv-motif', viewBox: '0 0 100 100', preserveAspectRatio: 'xMidYMax slice', 'aria-hidden': 'true', focusable: 'false' }, g);
}

function markSvg(kind) {
  const p = {
    leaf: 'M12 21 C12 14 12 9 12 4 M12 14 C9 12 8 9 9 7 C11 9 12 11 12 14 M12 11 C15 9 16 7 15 5 C13 7 12 9 12 11',
    mountain: 'M3 18 L9 10 L12 14 L15 9 L21 18',
    flower: 'M12 6 V18 M6 12 H18 M8 8 L16 16 M16 8 L8 16',
    drops: 'M8 6 l-1.5 3 M13 9 l-1.5 3 M17 5 l-1.5 3 M10 14 l-1.5 3 M15 15 l-1.5 3',
    star: 'M12 4 L14 10 L20 10 L15 14 L17 20 L12 16 L7 20 L9 14 L4 10 L10 10Z',
    wave: 'M3 12 Q6 8 9 12 T15 12 T21 12 M3 17 Q6 13 9 17 T15 17 T21 17',
    diamond: 'M12 4 L18 12 L12 20 L6 12Z M12 8 L15 12 L12 16 L9 12Z',
  }[kind];
  return svg('svg', { class: 'sp-mark', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: p, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}

function artImg(id, pos, cls = 'book-art') {
  const url = imageUrl(id);
  if (!url) return null;
  const p = pos || { x: 50, y: 50, s: 1 };
  const img = h('img', { class: cls, alt: '', decoding: 'async', draggable: 'false', loading: 'lazy' });
  img.style.objectPosition = `${p.x}% ${p.y}%`;
  img.style.transformOrigin = `${p.x}% ${p.y}%`;
  if (p.s && p.s !== 1) img.style.transform = `scale(${p.s})`;
  img.onerror = () => { img.remove(); };
  img.src = url;
  return img;
}

function authorName() {
  return (S.shop && S.shop.owner) || '';
}

// ---------- spine ----------
/** Decide font size / columns for a vertical spine title. Shared by layout and rendering. */
export function spineFit(t, w, ht, style = 'plain') {
  const avail = Math.max(24, ht - (style === 'label' || style === 'frame' ? 0.32 : style === 'ribs' ? 0.36 : 0.24) * ht - 18);
  const units = textUnits(t);
  const fs1 = clamp(Math.floor(w * 0.42), 11, 19);
  const fs2 = clamp(Math.floor(w * 0.34), 11, 15);
  if (units * fs1 * 1.04 <= avail) return { text: t, fs: fs1, cols: 1, maxH: avail };
  if (units * fs2 * 1.04 <= avail) return { text: t, fs: fs2, cols: 1, maxH: avail };
  const fsTwo = clamp(Math.floor((w - 10) / 2.5), 10, 14);
  if (w >= fsTwo * 2.4 + 8) {
    const per = Math.floor(avail / (fsTwo * 1.04));
    const text = truncateUnits(t, per * 2);
    const half = Math.ceil(textUnits(text) / 2);
    return { text, fs: fsTwo, cols: 2, maxH: Math.min(avail, (half + 0.6) * fsTwo * 1.04 + 2) };
  }
  return { text: truncateUnits(t, Math.floor(avail / (fs2 * 1.04))), fs: fs2, cols: 1, maxH: avail };
}
/** Spine thickness needed so the title can be set in two columns. */
export function spineNeedsTwoCols(t, ht) {
  const avail = ht * 0.72 - 18;
  return textUnits(t) * 11 * 1.04 > avail;
}

/**
 * @param b book, @param theme, @param o {w,h} px
 */
export function renderSpine(b, theme, o) {
  const look = bookLook(b, theme);
  const { w, h: ht } = o;
  const el = h('button', {
    class: `book spine mat-${look.material} ss-${look.spineStyle}${look.light ? ' is-light' : ''}${o.lean ? ' lean' : ''}`,
    type: 'button', 'data-id': b.id,
    'aria-label': `${b.title}${o.vol ? `（${o.vol}巻）` : b.kind !== 'single' ? `（全${b.articleIds.length}話）` : ''}`,
  });
  if (o.vol) el.dataset.vol = String(o.volIndex);
  setVars(el, look, w, ht);
  const face = h('span', { class: 'sp', 'aria-hidden': 'true' });
  weather(face, b, look);
  const art = b.design.spineImageId ? artImg(b.design.spineImageId, b.design.spinePos) : null;
  if (art) { face.appendChild(art); el.classList.add('has-art'); }
  face.appendChild(h('span', { class: 'sp-band t' }));
  if (!art || b.design.showTitle !== false) {
    const t = spineTitle(b);
    const fit = spineFit(t, w, ht, look.spineStyle);
    const title = h('span', { class: 'sp-title' }, fit.text);
    title.style.fontSize = fit.fs + 'px';
    title.style.maxHeight = fit.maxH + 'px';
    face.appendChild(h('span', { class: 'sp-label' }, title));
  } else {
    face.appendChild(h('span', { class: 'sp-label empty' }));
  }
  if (o.vol) face.appendChild(h('span', { class: 'sp-vol' }, o.vol));
  else if (ht > 120 && !art) face.appendChild(markSvg(look.mark));
  face.appendChild(h('span', { class: 'sp-band b' }));
  const obi = obiOf(b);
  if (obi && ht > 90) { const band = h('span', { class: 'sp-obi' }); band.style.background = obi.color; face.appendChild(band); el.classList.add('has-obi'); }
  el.appendChild(face);
  return el;
}

/** A book lying flat (平積み): its spine seen horizontally. o: {w (length), h (thickness)} */
export function renderFlat(b, theme, o) {
  const look = bookLook(b, theme);
  const { w, h: ht } = o;
  const el = h('button', {
    class: `book flat mat-${look.material}${look.light ? ' is-light' : ''}`, type: 'button', 'data-id': b.id,
    'aria-label': `${b.title}${o.vol ? `（${o.vol}巻）` : ''}（平積み）`,
  });
  if (o.vol) el.dataset.vol = String(o.volIndex);
  setVars(el, look, w, ht);
  const face = h('span', { class: 'sp fl', 'aria-hidden': 'true' });
  weather(face, b, look);
  const fs = clamp(Math.floor(ht * 0.5), 10, 15);
  const t = h('span', { class: 'fl-title' }, truncateUnits(spineTitle(b), Math.max(4, Math.floor((w - 24) / (fs * 1.02)) - (o.vol ? 1 : 0))));
  t.style.fontSize = fs + 'px';
  face.append(h('span', { class: 'fl-band l' }), t);
  if (o.vol) face.appendChild(h('span', { class: 'fl-vol' }, o.vol));
  face.appendChild(h('span', { class: 'fl-band r' }));
  const obi = obiOf(b);
  if (obi) { const band = h('span', { class: 'fl-obi' }); band.style.background = obi.color; face.appendChild(band); }
  el.appendChild(face);
  return el;
}

function weather(face, b, look) {
  const f = fadeOf(b);
  const filt = fadeFilter(f, look.material === 'worn');
  if (filt) face.style.filter = filt;
}

// ---------- cover ----------
export function coverLayout(b) {
  const id = coverImageId(b);
  if (!id) return 'text';
  if (b.design.coverLayout) return b.design.coverLayout;
  const img = S.images.get(id);
  if (img && img.w && img.h && img.w / img.h > 1.15) return 'plate';
  return 'full';
}

export function renderCover(b, theme, o) {
  const look = bookLook(b, theme);
  const { w, h: ht } = o;
  const layout = coverLayout(b);
  const el = h('button', {
    class: `book cover mat-${look.material} cv-${layout}${look.light ? ' is-light' : ''}${o.large ? ' is-large' : ''}`,
    type: 'button', 'data-id': b.id,
    'aria-label': `${b.title}${b.kind !== 'single' ? `（全${b.articleIds.length}話）` : ''}`,
  });
  if (o.static) { el.setAttribute('tabindex', '-1'); el.setAttribute('aria-hidden', 'true'); }
  setVars(el, look, w, ht);
  const face = h('span', { class: 'cv', 'aria-hidden': 'true' });
  weather(face, b, look);
  const d = b.design;
  const imgId = coverImageId(b);
  const obi = obiOf(b);
  const showTitle = d.showTitle !== false;
  const fsBase = clamp(w * 0.105, 10, 34);
  // covers print the short title (tags / notes removed); the full title is shown in the panel
  const ct = coverTitle(b);
  const title = h('span', { class: `cv-title${d.titleWriting === 'vertical' ? ' vertical' : ''} align-${d.titleAlign || 'top'}` }, ct);
  title.style.fontSize = (textUnits(ct) > 22 ? fsBase * 0.82 : fsBase) + 'px';
  // the obi covers the lower part of the cover (as on real books), so the author name moves away
  const author = d.showAuthor !== false && authorName() && !obi ? h('span', { class: 'cv-author' }, authorName()) : null;

  if (layout === 'full') {
    face.appendChild(artImg(imgId, d.coverPos));
    if (showTitle) face.append(h('span', { class: 'cv-scrim' }), title);
    if (author && showTitle) face.appendChild(author);
  } else if (layout === 'plate') {
    if (showTitle) face.appendChild(title);
    const plate = h('span', { class: 'cv-plate' }, artImg(imgId, d.coverPos));
    face.appendChild(plate);
    if (author) face.appendChild(author);
  } else {
    if (showTitle) face.appendChild(title);
    const m = (d.motif === 'none') ? null : motifSvg(look.motif, look);
    if (m) face.appendChild(m);
    if (author) face.appendChild(author);
  }
  if (obi) {
    const band = h('span', { class: 'cv-obi' }, h('span', { class: 'cv-obi-t' }, obi.text));
    band.style.background = obi.color; band.style.color = obi.ink;
    band.style.fontSize = clamp(w * 0.074, 8, 22) + 'px';
    face.appendChild(band);
    el.classList.add('has-obi');
  }
  el.appendChild(face);
  el.appendChild(h('span', { class: 'pages', 'aria-hidden': 'true' }));
  return el;
}

function setVars(el, look, w, ht) {
  el.style.setProperty('--c', look.color);
  el.style.setProperty('--ink', look.ink);
  el.style.setProperty('--m1', look.m1);
  el.style.setProperty('--m2', look.m2);
  el.style.width = Math.round(w) + 'px';
  el.style.height = Math.round(ht) + 'px';
}

/** Chapter count label etc. */
export function bookMeta(b) {
  const arts = bookArticles(b);
  const parts = [];
  if (b.kind === 'serial') parts.push(`連載・全${arts.length}話`);
  else if (b.kind === 'anthology') parts.push(`短編集・${arts.length}編`);
  if (b.seriesStatus === 'ongoing') parts.push('連載中');
  if (b.seriesStatus === 'complete') parts.push('完結');
  return parts;
}
