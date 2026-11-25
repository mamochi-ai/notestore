// Shop screen: header, shelf tabs, bookcase (bays), detail panel.
import { h, clamp, textUnits, debounce, formatDate, $, $$, prefersReducedMotion, hash32, rand01 } from './util.js';
import { getTheme } from './themes.js';
import { S, UNSORTED, visibleBooks, booksOnShelf, byOrder, bookArticles, bookUrl, bookStatus, STATUS_LABEL, imageUrl, saveBooks, saveShop, shelfExists } from './state.js';
import { renderSpine, renderCover, renderFlat, bookDims, spineTitle, bookMeta, spineNeedsTwoCols } from './bookview.js';
import { faceOf, volumesOf, lengthThickness, prepareFade, applySignFont, sealEl, monthlyPick, monthLabel, startLightClock } from './individual.js';
import { icon, logo, btn, anyModalOpen } from './ui.js';
import { bookReadingTime, formatMinutes, CHARS_PER_MINUTE } from './readtime.js';
import { hasPaid } from './paywall.js';

export const view = { tab: 'all', query: '', selected: null, owner: false };

let ctx = null;          // callbacks from main.js
let root = null;
let caseEl = null;
let lastWidth = 0;

/**
 * ctx: { editing, banner(Node|null), canRead(b), onRead(b), headerActions(): Node[],
 *        editTools(b): Node|null, editBar(): Node|null, footer(): Node|null }
 */
export function mountShop(container, context) {
  ctx = context;
  root = container;
  render();
}

export function render({ keepScroll = true } = {}) {
  if (!root || !S.shop) return;
  const theme = getTheme(S.shop.theme);
  // Redrawing replaces the whole page. Hold its height and scroll position so the shelf
  // does not jump (the browser would otherwise clamp the scroll while the page is momentarily short).
  const sx = window.scrollX, sy = window.scrollY;
  if (keepScroll && root.isConnected) root.style.minHeight = root.offsetHeight + 'px';
  applySignFont();
  startLightClock();
  if (view.selected && !S.books.has(view.selected)) view.selected = null;
  if (view.tab !== 'all' && view.tab !== 'search' && !shelfExists(view.tab)) view.tab = 'all';
  root.classList.toggle('editing', !!ctx.editing);

  const header = h('header', { class: 'shop-header' },
    h('div', { class: 'shop-brand' }, logo(),
      h('h1', { class: 'shop-name' }, S.shop.name || 'わたしの小さな本屋'),
      sealEl(30),
      S.shop.tagline ? h('p', { class: 'shop-tagline' }, S.shop.tagline) : null),
    h('div', { class: 'shop-actions' }, ...(ctx.headerActions ? ctx.headerActions() : [])));

  const main = h('div', { class: 'shop-main with-panel' });
  const wrap = h('div', { class: 'case-wrap' });
  caseEl = h('div', { class: 'case', role: 'region', 'aria-label': '本棚' });
  const guide = ctx.guide ? ctx.guide() : null;
  if (guide) wrap.appendChild(guide);
  wrap.appendChild(caseEl);
  main.appendChild(wrap);
  const panel = renderPanel(theme);
  if (panel) main.appendChild(panel);

  root.replaceChildren(...[
    ctx.editBar ? ctx.editBar() : null,
    ctx.banner ? ctx.banner() : null,
    header,
    renderNav(),
    main,
    ctx.footer ? ctx.footer() : null,
  ].filter(Boolean));
  if (!window.matchMedia('(min-width: 960px)').matches && (view.selected || view.owner)) {
    const bd = h('div', { class: 'sheet-backdrop', onclick: () => { closeDetail(); } });
    main.appendChild(bd);
  }
  layoutCase(theme);
  observeResize();
  if (keepScroll) {
    if (Math.abs(window.scrollY - sy) > 1) window.scrollTo(sx, sy);
    requestAnimationFrame(() => { root.style.minHeight = ''; if (Math.abs(window.scrollY - sy) > 1) window.scrollTo(sx, sy); });
  } else root.style.minHeight = '';
}

function renderNav() {
  const shelves = S.shop.shelves.filter((s) => ctx.editing || booksOnShelf(s.id).length);
  const ordered = [...shelves.filter((s) => s.id !== UNSORTED), ...shelves.filter((s) => s.id === UNSORTED)];
  const tab = (id, label) => h('button', {
    class: 'shelf-tab', role: 'tab', type: 'button', 'aria-selected': String(view.tab === id),
    onclick: () => {
      view.tab = id; view.query = '';
      render({ keepScroll: false });
      // show the top of the chosen shelf
      const nav = $('.shelf-nav', root);
      if (nav && nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: 'start' });
    },
  }, label);
  const input = h('input', { type: 'search', placeholder: '本をさがす', 'aria-label': '本を検索', value: view.query, enterkeyhint: 'search' });
  const search = h('div', { class: `search${view.query ? ' open' : ''}` },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '検索', onclick: () => { search.classList.add('open'); input.focus(); } }, icon('search')),
    input);
  const doSearch = debounce(() => {
    view.query = input.value.trim();
    view.tab = view.query ? 'search' : 'all';
    const pos = input.selectionStart;
    render();
    const ni = $('.search input', root);
    if (ni) { ni.focus(); try { ni.setSelectionRange(pos, pos); } catch { /* */ } }
  }, 250);
  input.addEventListener('input', doSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; doSearch.flush(); } });
  return h('nav', { class: 'shelf-nav', 'aria-label': '棚のカテゴリ' },
    h('div', { class: 'shelf-tabs', role: 'tablist' },
      tab('all', 'すべて'),
      ...ordered.map((s) => tab(s.id, s.name))),
    search);
}

// ---------- layout / packing ----------
export function geometry(W, theme) {
  // Narrow screens: scale the shelf image uniformly (cropping the plain left/right edges)
  // so bays are taller; the image is never stretched, so book coordinates stay aligned.
  const zoom = W < 520 ? 1.5 : W < 700 ? 1.2 : 1;
  const cropTop = W < 520 ? 0.12 : 0.32;
  const H = W * zoom * theme.imgH * (1 - cropTop) / theme.imgW;
  const baseIn = (theme.baseline - cropTop) / (1 - cropTop); // fraction from top of bay
  const rowBottom = H * (1 - baseIn);
  const maxBookH = H * baseIn - H * 0.07 - (W < 520 ? 4 : 8);
  const rowW = W * 0.93;
  // plank front face (between the measured front edge and the bottom of the image)
  const plankTop = H * (theme.frontEdge - cropTop) / (1 - cropTop);
  const plankH = H - plankTop;
  const labelH = clamp(plankH * 0.8, 16, 30);
  return { W, H, zoom, cropTop, rowBottom, maxBookH, rowW, labelTop: plankTop + (plankH - labelH) / 2, labelH };
}

export function spineSize(b, g) {
  const { hf, wf } = bookDims(b);
  const ht = g.maxBookH * (0.76 + 0.22 * hf);
  const real = lengthThickness(b, ht);
  let w = real != null ? real : clamp(ht * (0.15 + 0.07 * wf), 36, 66);
  // thicker spine when the title needs two columns
  if (spineNeedsTwoCols(spineTitle(b), ht)) w = clamp(Math.max(w, 44), 44, Math.max(70, w));
  if (real == null && b.kind !== 'single') w = clamp(w + Math.min(b.articleIds.length, 8) * 2.2, 36, 76);
  return { w, h: ht };
}
export function coverSize(g, k = 0.86) {
  const ht = g.maxBookH * k;
  return { w: ht * 0.7, h: ht };
}

function layoutCase(theme) {
  if (!caseEl) return;
  prepareFade();
  const W = Math.floor(caseEl.clientWidth - 28) || 600; // case padding
  lastWidth = caseEl.clientWidth;
  const g = geometry(W, theme);
  const frag = document.createDocumentFragment();

  if (view.tab === 'search') {
    const q = view.query.toLowerCase();
    const hits = visibleBooks().filter((b) => (b.title + ' ' + spineTitle(b) + ' ' + bookArticles(b).map((a) => a.title).join(' ')).toLowerCase().includes(q)).sort(byOrder);
    frag.appendChild(shelfGroup({ id: null, name: `「${view.query}」の検索結果（${hits.length}冊）` }, hits, g, theme, { empty: '見つかりませんでした。別のことばで探してみてください。', noDrag: true }));
  } else {
    if (view.tab === 'all') {
      const pick = monthlyPick();
      if (pick) frag.appendChild(monthlyBay(pick, g, theme));
      const feat = S.shop.featured.map((id) => S.books.get(id)).filter((b) => b && !b.hidden).slice(0, 3);
      if (feat.length || ctx.editing) frag.appendChild(featuredBay(feat, g, theme));
    }
    const shelves = view.tab === 'all' ? orderedShelves() : S.shop.shelves.filter((s) => s.id === view.tab);
    let any = false;
    for (const s of shelves) {
      const books = booksOnShelf(s.id);
      if (!books.length && !ctx.editing) continue;
      any = true;
      frag.appendChild(shelfGroup(s, books, g, theme, { empty: ctx.editing ? 'この棚はまだ空です。本を選んで「移動先」からここへ移せます。' : 'まだ本がありません' }));
    }
    if (!any && !(view.tab === 'all' && S.shop.featured.length)) {
      frag.appendChild(shelfGroup({ id: null, name: '' }, [], g, theme, { empty: ctx.editing ? 'まだ本がありません。「記事を読み込む」から始めましょう。' : 'まだ本が並んでいません' }));
    }
  }
  caseEl.replaceChildren(frag);
  if (view.selected) for (const el of caseEl.querySelectorAll(`.book[data-id="${CSS.escape(view.selected)}"]`)) el.classList.add('is-selected');
  bindBookEvents(caseEl);
}

export function orderedShelves() {
  return [...S.shop.shelves.filter((s) => s.id !== UNSORTED), ...S.shop.shelves.filter((s) => s.id === UNSORTED)];
}

function shelfLabel(text, g) {
  const el = h('div', { class: 'shelf-label', title: text }, text);
  el.style.top = g.labelTop + 'px';
  el.style.height = g.labelH + 'px';
  el.style.fontSize = clamp(g.labelH * 0.5, 10, 15) + 'px';
  return el;
}

function bayEl(g, theme) {
  const bay = h('div', { class: 'bay' });
  bay.style.height = g.H + 'px';
  bay.style.backgroundImage = `url("${theme.img}")`;
  bay.style.backgroundSize = `${g.zoom * 100}% auto`;
  // time-of-day light layers (styled per phase in CSS; inert for pointer and screen readers)
  bay.append(h('span', { class: 'bay-tint', 'aria-hidden': 'true' }), h('span', { class: 'bay-glow', 'aria-hidden': 'true' }));
  return bay;
}

/** Gap placed before an item: spines lean together, covers / POP get an intended space. */
export function itemGap(prev, it, g) {
  if (!prev) return 0;
  const tight = (x) => x.kind === 'book' && (x.face === 'spine' || x.face === 'lean');
  if (tight(prev) && tight(it)) return 1;
  if (it.kind === 'pop') return 4; // a POP stands right next to its own book
  return clamp(g.W * 0.022, 8, 18);
}
const LEAN = Math.sin(6 * Math.PI / 180);
function flatSize(b, g, vol) {
  const { hf, wf } = bookDims(b);
  const len = coverSize(g).h * (0.82 + 0.14 * hf) * (vol ? 0.97 : 1);
  const sp = spineSize(b, g);
  return { w: len, h: clamp(sp.w * 0.56 + wf * 4, 15, 34) };
}
export function buildItems(books, g) {
  const items = [];
  let pile = null;
  const pops = [];
  const flushPops = () => { while (pops.length) items.push(pops.shift()); };
  const popFor = (b) => {
    if (!(b.pop && b.popOnShelf !== false && b.pop.length <= 40)) return null;
    const pw = clamp(g.W * 0.14, 80, 124);
    return { kind: 'pop', b, w: pw, pw, ph: clamp(g.maxBookH * 0.46, 60, 112) };
  };
  for (const b of books) {
    const face = faceOf(b);
    const vols = volumesOf(b);
    if (face === 'flat') {
      // 平積み: like a bookshop table display — several copies of the SAME book stacked
      // (or its volumes 上・中・下), with one copy standing face-out on top of the stack.
      pile = null; flushPops();
      const copies = vols
        ? vols.map((v) => ({ vol: v.label, volIndex: v.index })).reverse()
        : Array.from({ length: 3 + (hash32(b.id + ':copies') % 2) }, () => ({ vol: null, volIndex: null }));
      const fs = flatSize(b, g);
      const th = Math.max(12, Math.min(fs.h, (g.maxBookH * 0.4) / copies.length));
      const stackH = th * copies.length;
      const coverH = Math.min(g.maxBookH * 0.96 - stackH, coverSize(g).h * 0.86);
      const cover = coverH >= 56 ? { w: Math.min(coverH * 0.7, fs.w * 0.86), h: Math.min(coverH, fs.w * 0.86 / 0.7) } : null;
      items.push({
        kind: 'pile', face: 'pile', b, cover, w: fs.w + 10,
        entries: copies.map((c, i) => ({ b, vol: c.vol, volIndex: c.volIndex, copy: i, size: { w: fs.w * (1 - (i % 2) * 0.01), h: th } })),
      });
      const p = popFor(b); if (p) items.push(p);
      continue;
    }
    pile = null; flushPops();
    if (face === 'cover') {
      const size = coverSize(g);
      items.push({ kind: 'book', b, face, w: size.w + 6, size });
    } else if (vols && face === 'spine') {
      for (const v of vols) {
        const size = spineSize({ ...b, articleIds: v.articleIds, chars: undefined, kind: 'serial' }, g);
        items.push({ kind: 'book', b, face: 'spine', vol: v.label, volIndex: v.index, w: size.w, size });
      }
    } else {
      const size = spineSize(b, g);
      const lean = face === 'lean';
      items.push({ kind: 'book', b, face, lean, w: size.w + (lean ? size.h * LEAN : 0), size });
    }
    const p = popFor(b); if (p) items.push(p);
  }
  flushPops();
  return items;
}
export const bookendW = (g) => clamp(g.maxBookH * 0.05, 8, 12);
/**
 * Pack items into bays WITHOUT changing their saved order.
 * A book and its POP stay together. When a shelf needs several bays, the items are
 * balanced across them so the last bay is not left almost empty.
 */
export function packBays(items, g) {
  const units = [];
  for (const it of items) {
    if (it.kind === 'pop' && units.length) units[units.length - 1].push(it);
    else units.push([it]);
  }
  const widthOf = (list) => list.reduce((n, it, i) => n + it.w + itemGap(list[i - 1], it, g), 0);
  const room = g.rowW - bookendW(g) * 2 - 12;
  const total = widthOf(items);
  const k = Math.max(1, Math.ceil(total / room));
  const target = total / k;
  const bays = [[]];
  for (const u of units) {
    const cur = bays[bays.length - 1];
    const next = widthOf([...cur, ...u]);
    const over = next > room || (k > 1 && bays.length < k && widthOf(cur) >= target * 0.92 && next > target * 1.05);
    if (cur.length && over) bays.push([...u]);
    else cur.push(...u);
  }
  return bays;
}

function shelfGroup(shelf, books, g, theme, { empty, noDrag } = {}) {
  const group = h('section', { class: 'shelf-group', 'aria-label': shelf.name || '本棚' });
  const bays = packBays(buildItems(books, g), g);
  const bw = bookendW(g);
  bays.forEach((list, i) => {
    const bay = bayEl(g, theme);
    if (i === 0 && shelf.name) bay.appendChild(shelfLabel(shelf.name, g));
    const row = h('div', { class: 'bay-row', 'data-shelf': shelf.id || '', 'data-nodrag': noDrag ? '1' : null });
    row.style.bottom = g.rowBottom + 'px';
    let used = 0;
    list.forEach((it, j) => { used += it.w + itemGap(list[j - 1], it, g); });
    // a group that does not fill the bay is displayed centred between two bookends,
    // so the shelf never looks empty on one side only
    const leftover = g.rowW - used;
    const ends = list.length && leftover > bw * 2 + 6;
    const bookend = (side) => {
      const be = h('span', { class: `bookend ${side}`, 'aria-hidden': 'true' });
      be.style.height = clamp(g.maxBookH * 0.42, 34, 96) + 'px';
      be.style.width = bw + 'px';
      return be;
    };
    if (ends) { row.classList.add('centered'); row.appendChild(bookend('left')); }
    list.forEach((it, j) => {
      let el;
      if (it.kind === 'pile') {
        el = h('div', { class: 'pile', 'data-id': it.b.id });
        el.style.width = it.w + 'px';
        it.entries.forEach((e, i) => {
          const fb = renderFlat(e.b, theme, { ...e.size, vol: e.vol, volIndex: e.volIndex });
          // copies are never stacked perfectly straight: a small, stable offset per copy
          fb.style.marginLeft = (4 + (rand01(e.b.id + ':copy' + i) - 0.5) * 9) + 'px';
          // one tap target per book: the standing copy (or the top copy when there is no room for it)
          const focusable = !it.cover && i === it.entries.length - 1;
          if (!focusable) { fb.setAttribute('tabindex', '-1'); fb.setAttribute('aria-hidden', 'true'); }
          el.appendChild(fb);
        });
        if (it.cover) {
          const top = h('div', { class: 'pile-top' }, renderCover(it.b, theme, it.cover));
          top.firstChild.setAttribute('aria-label', `${it.b.title}（平積み）`);
          el.appendChild(top);
        }
      } else if (it.kind === 'book') {
        el = it.face === 'cover' ? renderCover(it.b, theme, it.size) : renderSpine(it.b, theme, { ...it.size, lean: it.lean, vol: it.vol, volIndex: it.volIndex });
        if (it.lean) el.style.marginRight = (it.size.h * LEAN) + 'px';
      } else {
        el = h('button', { type: 'button', class: `pop-mini${theme.pop === 'dark' ? ' dark' : ''}`, 'data-pop-for': it.b.id, 'aria-label': `POP：${it.b.pop}` },
          h('span', { class: 'pop-card' }, it.b.pop), h('span', { class: 'pop-foot', 'aria-hidden': 'true' }));
        el.style.width = it.pw + 'px';
        el.style.height = it.ph + 'px';
        el.style.fontSize = clamp(it.pw / 9, 11, 14) + 'px';
      }
      const gap = itemGap(list[j - 1], it, g);
      el.style.marginLeft = (j === 0 ? (ends ? 0 : 0) : gap) + 'px';
      row.appendChild(el);
    });
    if (ends) row.appendChild(bookend('right'));
    bay.appendChild(row);
    if (!list.length) bay.appendChild(h('p', { class: 'bay-empty' }, empty || 'まだ本がありません'));
    group.appendChild(bay);
  });
  return group;
}

function monthlyBay(pick, g, theme) {
  const label = `${monthLabel(pick.month)}の一冊`;
  const group = h('section', { class: 'shelf-group monthly-group', 'aria-label': `店主の${label}` });
  const bay = bayEl(g, theme);
  bay.appendChild(shelfLabel(`店主の${label}`, g));
  const row = h('div', { class: 'bay-row featured monthly', 'data-nodrag': '1' });
  row.style.bottom = (g.rowBottom - 4) + 'px';
  const narrow = g.W < 520;
  const size = coverSize(g, 0.95);
  const w = narrow ? Math.min(size.w, g.rowW * 0.42) : size.w;
  row.appendChild(h('div', { class: 'feat' }, renderCover(pick.book, theme, { w, h: w / 0.7 }), h('span', { class: 'stand', 'aria-hidden': 'true' })));
  const note = pick.note || pick.book.pop || '';
  if (note) {
    const cw = narrow ? g.rowW * 0.46 : clamp(g.rowW * 0.34, 150, 300);
    const card = h('button', { type: 'button', class: `pop-sign monthly-note${theme.pop === 'dark' ? ' dark' : ''}`, 'data-pop-for': pick.book.id, 'aria-label': `店主のことば：${note}` },
      h('span', { class: 'mn-text' }, note), sealEl(narrow ? 26 : 34));
    card.style.width = cw + 'px';
    card.style.minHeight = (w / 0.7) * 0.55 + 'px';
    card.style.fontSize = clamp(cw / 13, 12, 18) + 'px';
    card.style.marginBottom = '14px';
    row.appendChild(card);
  }
  if (!pick.current && ctx.editing) bay.appendChild(h('p', { class: 'bay-empty monthly-hint' }, `${monthLabel(pick.month)}のままです。本を選んで「今月の一冊にする」で更新できます。`));
  bay.appendChild(row);
  group.appendChild(bay);
  return group;
}

function featuredBay(books, g, theme) {
  const group = h('section', { class: 'shelf-group featured-group', 'aria-label': '初めての方へ' });
  const bay = bayEl(g, theme);
  bay.appendChild(shelfLabel('初めての方へ', g));
  const row = h('div', { class: 'bay-row featured', 'data-nodrag': '1' });
  row.style.bottom = (g.rowBottom - 4) + 'px';
  const size = coverSize(g, 0.9);
  const narrow = g.W < 520;
  const showSign = !!S.shop.featuredPop && !narrow && books.length > 0;
  const n = Math.max(books.length, 1);
  const gapPx = g.rowW * 0.04;
  const slots = n + (showSign ? 0.95 : 0);
  const w = Math.min(size.w, (g.rowW - gapPx * (n + (showSign ? 1 : 0) - 1) - n * 12) / slots);
  const s2 = { w, h: w / 0.7 };
  if (showSign) {
    const sw = w * 0.95;
    const sign = h('div', { class: `pop-sign${theme.pop === 'dark' ? ' dark' : ''}` }, h('span', null, S.shop.featuredPop));
    sign.style.width = sw + 'px';
    sign.style.minHeight = s2.h * 0.5 + 'px';
    sign.style.fontSize = clamp(sw / 8, 11, 20) + 'px';
    sign.style.marginBottom = '14px';
    row.appendChild(sign);
  }
  for (const b of books) {
    const f = h('div', { class: 'feat' }, renderCover(b, theme, s2), h('span', { class: 'stand', 'aria-hidden': 'true' }));
    row.appendChild(f);
  }
  if (!books.length) bay.appendChild(h('p', { class: 'bay-empty' }, '本を選んで「おすすめに飾る」を押すと、ここに3冊まで表紙向きで並びます。'));
  bay.appendChild(row);
  group.appendChild(bay);
  return group;
}

// ---------- interactions ----------
function bindBookEvents(container) {
  container.addEventListener('click', (e) => {
    if (dragState.justDropped) { dragState.justDropped = false; return; }
    const pop = e.target.closest('[data-pop-for]');
    const bookEl = e.target.closest('.book');
    const id = bookEl ? bookEl.dataset.id : pop ? pop.dataset.popFor : null;
    if (!id) return;
    selectBook(id);
  });
  if (ctx.editing) enableDrag(container);
}

export function selectBook(id) {
  view.selected = id;
  view.owner = false;
  render();
  const panel = $('.detail', root);
  if (panel) {
    if (window.matchMedia('(min-width: 960px)').matches) panel.scrollTop = 0;
    const heading = $('h2', panel);
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
  }
}
export function closeDetail() {
  const id = view.selected;
  view.selected = null; view.owner = false;
  render();
  if (id) { const el = $(`.bay .book[data-id="${CSS.escape(id)}"]`, root); if (el) el.focus({ preventScroll: true }); }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && root && root.isConnected && !anyModalOpen() && !document.querySelector('.reader') && (view.selected || view.owner)) {
    closeDetail();
  }
});

function renderPanel(theme) {
  const wide = window.matchMedia('(min-width: 960px)').matches;
  const b = view.selected ? S.books.get(view.selected) : null;
  if (!b && !wide && !view.owner) return null;
  const panel = h('aside', { class: 'detail', 'aria-label': b ? '本の詳細' : '店主について', role: wide ? null : 'dialog', 'aria-modal': wide ? null : 'true' });
  if (b || (!wide && view.owner)) panel.appendChild(h('button', { class: 'icon-btn detail-close', type: 'button', 'aria-label': '閉じる', onclick: closeDetail }, icon('close')));
  if (!b) { panel.appendChild(ownerCard()); return panel; }

  // 1. cover + title
  const cw = wide ? 190 : 140;
  const cover = renderCover(b, theme, { w: cw, h: cw / 0.7, large: true, static: true });
  panel.appendChild(h('div', { class: 'detail-cover' }, cover));
  panel.appendChild(h('h2', null, b.title || '無題'));
  // 2. series status, chapters, reading time (only from real body text)
  const arts = bookArticles(b);
  const readable = ctx.canRead(b) ? arts.filter((a) => a.html) : [];
  const rt = readable.length ? bookReadingTime(readable) : null;
  const chips = bookMeta(b).map((t) => h('li', { class: 'chip' }, t));
  const vols = volumesOf(b);
  if (vols) chips.push(h('li', { class: 'chip' }, `全${vols.length}巻`));
  if (!arts.length && b.chapters && b.chapters.length > 1) chips.push(h('li', { class: 'chip' }, `全${b.chapters.length}話`));
  if (hasPaid(b) || b.paidNote || arts.some((a) => a.paidCut)) chips.push(h('li', { class: 'chip', title: 'noteでは一部が有料の記事です' }, '一部有料'));
  if (rt && rt.total) chips.push(h('li', { class: 'chip', title: `本文の文字数から ${CHARS_PER_MINUTE}字/分 で計算した目安です` }, `読了目安 ${formatMinutes(rt.total)}`));
  if (arts[0] && arts[0].date) chips.push(h('li', { class: 'chip' }, formatDate(arts[0].date)));
  if (ctx.editing) {
    const st = bookStatus(b);
    chips.push(h('li', { class: `chip ${st === 'publish' ? 'ok' : 'warn'}` }, STATUS_LABEL[st] || st));
    if (b.shareBody) chips.push(h('li', { class: 'chip warn' }, '本文を共有'));
  }
  if (chips.length) panel.appendChild(h('ul', { class: 'meta' }, chips));
  // 3. short introduction
  if (b.blurb) panel.appendChild(h('p', { class: 'blurb' }, b.blurb));
  // 4. for whom / owner's reason (only when filled in)
  if (b.forWhom || b.pop) {
    const notes = h('dl', { class: 'reco' });
    if (b.forWhom) notes.append(h('dt', null, 'こんな人へ'), h('dd', { class: 'for-whom' }, b.forWhom));
    if (b.pop) notes.append(h('dt', null, '店主のおすすめ理由'), h('dd', null, h('span', { class: 'pop small' }, b.pop)));
    panel.appendChild(notes);
  }
  // 5. main actions
  const actions = h('div', { class: 'detail-actions' });
  if (readable.length) actions.appendChild(btn('この本を読む', () => ctx.onRead(b), { cls: 'primary', iconName: 'book' }));
  const url = bookUrl(b);
  if (url) actions.appendChild(h('a', { class: `btn ${readable.length ? '' : 'primary'}`, href: url, target: '_blank', rel: 'noopener noreferrer' }, 'noteで読む', icon('ext')));
  if (actions.childNodes.length) panel.appendChild(actions);
  // 6. table of contents: tap a chapter to open it directly
  const toc = arts.length > 1 ? arts.map((a, i) => ({ title: a.title || '（無題）', url: a.url, read: !!(readable.includes(a)), min: rt ? rt.chapters[readable.indexOf(a)] || 0 : 0, id: a.id }))
    : !arts.length && b.chapters && b.chapters.length > 1 ? b.chapters.map((c) => ({ title: c.title, url: c.url, read: false })) : null;
  if (toc) {
    panel.appendChild(h('h3', { class: 'section-title' }, b.kind === 'anthology' ? '収録作品' : '目次'));
    const volStart = new Map((vols || []).map((v) => [v.articleIds[0], v.label]));
    panel.appendChild(h('ol', { class: 'chapters' }, toc.flatMap((c) => [
      volStart.has(c.id) ? h('li', { class: 'vol-head' }, `${volStart.get(c.id)}巻`) : null,
      h('li', null,
      c.read
        ? h('button', { type: 'button', class: 'ch-link', onclick: () => ctx.onRead(b, { startArticleId: c.id }) }, h('span', { class: 'ch-t' }, c.title), c.min ? h('span', { class: 'ch-m' }, formatMinutes(c.min)) : null)
        : h('span', { class: 'ch-row' }, h('span', { class: 'ch-t' }, c.title),
          c.url ? h('a', { class: 'ch-note', href: c.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${c.title}をnoteで読む` }, 'noteで読む', icon('ext')) : null))]).filter(Boolean)));
  }
  if (ctx.editing && ctx.editTools) panel.appendChild(ctx.editTools(b));
  return panel;
}

function ownerCard() {
  const s = S.shop;
  const card = h('div', { class: 'owner-card' });
  const av = s.avatarImageId && imageUrl(s.avatarImageId);
  if (av) card.appendChild(h('img', { class: 'avatar', src: av, alt: '' }));
  card.appendChild(h('h2', null, s.owner ? `店主 ${s.owner}` : (s.name || '')));
  const seal = sealEl(56);
  if (seal) card.appendChild(h('div', { class: 'owner-seal' }, seal));
  if (s.intro) card.appendChild(h('p', { class: 'intro' }, s.intro));
  if (s.profileUrl) card.appendChild(h('p', null, h('a', { class: 'btn', href: s.profileUrl, target: '_blank', rel: 'noopener noreferrer' }, 'noteのプロフィール', icon('ext'))));
  const count = visibleBooks().length;
  card.appendChild(h('p', { class: 'hint' }, `${count}冊の本が並んでいます。気になる背表紙をタップしてください。`));
  if (ctx.editing && !s.intro && !s.owner) card.appendChild(h('p', { class: 'note-box' }, '「お店の設定」で店主名や自己紹介を入れると、ここに表示されます。'));
  return card;
}

// ---------- resize ----------
let ro = null;
function observeResize() {
  if (ro) ro.disconnect();
  if (!('ResizeObserver' in window)) return;
  const relayout = debounce(() => {
    if (!caseEl || !caseEl.isConnected) return;
    if (Math.abs(caseEl.clientWidth - lastWidth) < 2) return;
    // panel presence depends on the breakpoint; re-render everything when crossing it
    render();
  }, 120);
  ro = new ResizeObserver(relayout);
  ro.observe(caseEl);
}
let lastWide = window.matchMedia('(min-width: 960px)').matches;
window.addEventListener('resize', () => {
  const w = window.matchMedia('(min-width: 960px)').matches;
  if (w !== lastWide) { lastWide = w; if (root && root.isConnected) render(); }
});

// ---------- drag to reorder (edit mode) ----------
const dragState = { active: false, justDropped: false };

function enableDrag(container) {
  container.addEventListener('pointerdown', (e) => {
    const bookEl = e.target.closest('.bay-row:not([data-nodrag]) .book');
    if (!bookEl || e.button > 0) return;
    const startX = e.clientX, startY = e.clientY;
    const isTouch = e.pointerType !== 'mouse';
    let started = false, timer = null, ghost = null, marker = null;
    const id = bookEl.dataset.id;

    const begin = () => {
      started = true; dragState.active = true;
      ghost = bookEl.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.classList.remove('is-selected');
      const r = bookEl.getBoundingClientRect();
      ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
      document.body.appendChild(ghost);
      bookEl.classList.add('dragging');
      marker = h('span', { class: 'drop-marker', 'aria-hidden': 'true' });
      moveGhost(startX, startY);
      if (navigator.vibrate) try { navigator.vibrate(10); } catch { /* */ }
    };
    const moveGhost = (x, y) => {
      if (!ghost) return;
      ghost.style.left = (x - ghost.offsetWidth / 2) + 'px';
      ghost.style.top = (y - ghost.offsetHeight * 0.8) + 'px';
      ghost.style.display = 'none';
      const under = document.elementFromPoint(x, y);
      ghost.style.display = '';
      if (!under) return;
      const row = under.closest('.bay-row:not([data-nodrag])');
      if (!row) return;
      const tb = under.closest('.book');
      const target = tb && row.contains(tb) ? [...row.children].find((c) => c === tb || c.contains(tb)) : null;
      if (target && target !== bookEl && !target.contains(bookEl) && target.classList && !target.classList.contains('bookend')) {
        const tr = target.getBoundingClientRect();
        if (x < tr.left + tr.width / 2) row.insertBefore(marker, target);
        else row.insertBefore(marker, target.nextSibling);
      } else if (!target) {
        const end = row.querySelector('.bookend');
        row.insertBefore(marker, end || null);
      }
    };
    const onMove = (ev) => {
      if (!started) {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (isTouch) { if (dist > 10) cleanup(); return; }
        if (dist > 6) begin(); else return;
      }
      ev.preventDefault();
      moveGhost(ev.clientX, ev.clientY);
    };
    const preventScroll = (ev) => { if (started) ev.preventDefault(); };
    const onUp = () => {
      if (started && marker && marker.parentNode) {
        const row = marker.parentNode;
        const shelfId = row.dataset.shelf || UNSORTED;
        let next = marker.nextElementSibling;
        const idOf = (el) => (el.classList.contains('book') ? el.dataset.id : el.querySelector('.book') ? el.querySelector('.book').dataset.id : null);
        while (next && (!idOf(next) || idOf(next) === id)) next = next.nextElementSibling;
        const beforeId = next ? idOf(next) : null;
        dropBook(id, shelfId, beforeId);
        dragState.justDropped = true;
        setTimeout(() => { dragState.justDropped = false; }, 400);
      }
      cleanup();
    };
    function cleanup() {
      clearTimeout(timer);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.removeEventListener('touchmove', preventScroll);
      if (ghost) ghost.remove();
      if (marker) marker.remove();
      bookEl.classList.remove('dragging');
      dragState.active = false;
    }
    if (isTouch) timer = setTimeout(begin, 380);
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.addEventListener('touchmove', preventScroll, { passive: false });
  });
  container.addEventListener('contextmenu', (e) => { if (e.target.closest('.book')) e.preventDefault(); });
}

/** Move book `id` to shelf before `beforeId` (null = end). Renumbers that shelf. */
export async function dropBook(id, shelfId, beforeId) {
  const b = S.books.get(id);
  if (!b) return;
  const list = booksOnShelf(shelfId).filter((x) => x.id !== id);
  let idx = beforeId ? list.findIndex((x) => x.id === beforeId) : list.length;
  if (idx < 0) idx = list.length;
  list.splice(idx, 0, b);
  b.shelfId = shelfId;
  list.forEach((x, i) => { x.order = i + 1; });
  render();
  await saveBooks(list).catch(() => {});
}

/** Move by one position within its shelf (accessible alternative to drag). */
export async function nudgeBook(id, delta) {
  const b = S.books.get(id);
  if (!b) return;
  const shelfId = shelfExists(b.shelfId) ? b.shelfId : UNSORTED;
  const list = booksOnShelf(shelfId);
  const i = list.findIndex((x) => x.id === id);
  const j = clamp(i + delta, 0, list.length - 1);
  if (i === j) return;
  list.splice(i, 1); list.splice(j, 0, b);
  list.forEach((x, k) => { x.order = k + 1; });
  render();
  await saveBooks(list).catch(() => {});
  const el = $(`.detail`, root);
  if (el) el.querySelector(delta < 0 ? '[data-nudge="-1"]' : '[data-nudge="1"]')?.focus();
}

export { saveShop };
