// Sharing. The public data is ALWAYS rebuilt from an explicit selection (never the owner's
// model as-is), and every incoming share is validated (size, types, URLs) before use.
//   A. shelf image (canvas)      B. lightweight link (#s=… in the URL fragment, no server)
//   C. publishable static ZIP (images + optionally body text of books the owner allowed)
import { zipSync, strToU8, strFromU8, deflateSync, inflateSync } from '../vendor/fflate.js';
import { h, toast, clamp, isNoteUrl, safeHttpUrl, shareOrDownload, downloadBlob, formatDate, $$, textUnits } from './util.js';
import { openModal, alertDialog, progressDialog, btn, icon } from './ui.js';
import { getTheme, THEME_MAP, inkFor } from './themes.js';
import { S, UNSORTED, visibleBooks, booksOnShelf, bookArticles, bookUrl, bookStatus, coverImageId, imageUrl, newBook, STATUS_LABEL, byOrder } from './state.js';
import { geometry, buildItems, packBays, orderedShelves, coverSize, itemGap, bookendW } from './shelf.js';
import { bookLook, spineTitle, coverTitle, spineFit, motifSvg, coverLayout, MOTIFS } from './bookview.js';
import { sanitizeHtml } from './sanitize.js';
import { splitHtml, markFor, hasPaid } from './paywall.js';
import { cleanShopExtras, cleanBookExtras, faceOf, bookChars, bookDate, obiOf, fadeOf, prepareFade, sealText, monthlyPick, monthLabel } from './individual.js';
import { extFor } from './images.js';

export const LINK_MAX = 8000; // conservative total URL length (verified in Chromium; iOS Safari not yet verified on device)

const eligible = (b) => bookStatus(b) === 'publish' && !!bookUrl(b);
const ineligibleReason = (b) => {
  const st = bookStatus(b);
  if (st !== 'publish') return `${STATUS_LABEL[st] || st}のため共有できません`;
  if (!bookUrl(b)) return 'noteのURLが分からないため共有できません';
  return '';
};

// ======================= share center =======================
export function openShareCenter(ctx) {
  const card = (title, lines, action) => h('div', { class: 'note-box', style: 'display:grid;gap:8px' },
    h('strong', { style: 'font-size:16px' }, title), ...lines.map((l) => h('span', { style: 'font-size:14px' }, l)), h('div', null, action));
  const m = openModal({
    title: 'お店をシェア', wide: true,
    body: h('div', null,
      h('p', { class: 'hint' }, 'どの方法でも、本文は最初は含まれません。下書き・予約・状態が分からない記事は共有できません。'),
      h('div', { class: 'grid2' },
        card('A. 本棚の画像を保存', ['自己紹介記事に貼るための一枚画像です。選んだ棚と店名を描きます。', 'リンクは入りません。'],
          btn('画像をつくる', () => { m.close(); openImageExport(); }, { cls: 'primary', iconName: 'image' })),
        card('B. 紹介リンク（手軽）', ['店名・テーマ・選んだ本のタイトル・noteのURL・POPだけをURLに入れます。サーバーは不要です。', '画像と本文は入らないため、相手には文字の表紙で表示されます。'],
          btn('リンクをつくる', () => { m.close(); openLinkShare(); }, { cls: 'primary', iconName: 'share' })),
        card('C. 公開用ZIP（完全版）', ['装丁画像・POP、許可した本の本文まで入った静的サイトのZIPです。', 'GitHub Pagesなどの静的ホスティングに置く作業が別途必要です。URLが自動で発行されるわけではありません。'],
          btn('ZIPをつくる', () => { m.close(); openPublishZip(); }, { cls: 'primary', iconName: 'download' }))),
      h('p', { class: 'hint' }, 'Bは手軽な紹介版、Cは装丁を保ったままの完全版です。画像込みの本屋を同じURLで更新し続けたい場合は、Cで作ったZIPを置き直す運用になります。')),
    actions: [{ label: '閉じる' }],
  });
}

// ---------- selection UI shared by B and C ----------
function bookSelector(state, { withBody = false } = {}) {
  const list = h('ul', { class: 'list' });
  const books = orderedShelves().flatMap((s) => booksOnShelf(s.id));
  for (const b of books) {
    const ok = eligible(b);
    const cb = h('input', { type: 'checkbox', checked: state.sel.has(b.id) || null, disabled: !ok || null, 'aria-label': `${b.title}を含める` });
    cb.addEventListener('change', () => { if (cb.checked) state.sel.add(b.id); else { state.sel.delete(b.id); state.body.delete(b.id); } state.onChange && state.onChange(); drawBody(); });
    const bodyCb = withBody ? h('input', { type: 'checkbox', checked: state.body.has(b.id) || null, 'aria-label': `${b.title}の本文を含める` }) : null;
    const bodyWrap = withBody ? h('label', { class: 'check', style: 'font-size:13px;min-height:0' }, bodyCb, h('span', null, '本文も公開する')) : null;
    function drawBody() { if (bodyWrap) { bodyWrap.hidden = !state.sel.has(b.id); bodyCb.checked = state.body.has(b.id); } }
    if (bodyCb) bodyCb.addEventListener('change', () => { if (bodyCb.checked) state.body.add(b.id); else state.body.delete(b.id); state.onChange && state.onChange(); });
    drawBody();
    list.appendChild(h('li', null, h('label', { class: 'check', style: 'flex:1;min-width:0' }, cb,
      h('span', { class: 'grow' }, h('span', { class: 'title' }, b.title), h('br'),
        h('span', { class: 'sub' }, ok ? `${b.kind !== 'single' ? `全${b.articleIds.length}話・` : ''}${bookUrl(b)}` : ineligibleReason(b)))), bodyWrap));
  }
  if (!books.length) list.appendChild(h('li', { class: 'hint' }, '本がありません'));
  return list;
}

/** Public model built ONLY from selected books and checked options. */
export function buildPublicModel({ ids, bodyIds = new Set(), pop = true, blurb = true, intro = true, images = false }) {
  const shop = S.shop;
  const selected = orderedShelves().flatMap((s) => booksOnShelf(s.id)).filter((b) => ids.has(b.id) && eligible(b));
  const usedShelves = orderedShelves().filter((s) => selected.some((b) => (b.shelfId === s.id) || (s.id === UNSORTED && !shop.shelves.some((x) => x.id === b.shelfId))));
  const imgs = new Map();
  const addImg = (id) => { if (images && id && S.images.has(id)) { imgs.set(id, S.images.get(id)); return id; } return null; };
  const books = selected.map((b) => {
    const arts = bookArticles(b);
    const d = b.design;
    const out = {
      id: b.id, title: b.title, spineTitle: b.spineTitle || null, kind: b.kind, mode: b.mode, writing: b.writing,
      shelfId: shop.shelves.some((x) => x.id === b.shelfId) ? b.shelfId : UNSORTED, order: b.order, face: b.face,
      seriesStatus: b.seriesStatus || null, url: bookUrl(b), paidNote: hasPaid(b),
      face: faceOf(b), obi: { text: (b.obi && b.obi.text) || '', color: (b.obi && b.obi.color) || null }, volumes: b.volumes || 0,
      ...(shop.thickness === 'length' && bookChars(b) ? { chars: Math.round(bookChars(b) / 100) * 100 || 100 } : {}),
      ...(bookDate(b) ? { date: new Date(bookDate(b)).toISOString().slice(0, 10) } : {}),
      chapters: arts.length > 1 ? arts.map((a) => ({ title: a.title, url: a.url || null })) : [],
      pop: pop ? b.pop || '' : '', popOnShelf: b.popOnShelf !== false, blurb: blurb ? b.blurb || '' : '', forWhom: blurb ? b.forWhom || '' : '',
      design: {
        color: d.color || null,
        material: d.material || null, motif: d.motif || null, spineStyle: d.spineStyle || null,
        showTitle: d.showTitle !== false, showAuthor: d.showAuthor !== false, titleColor: d.titleColor || null,
        titleAlign: d.titleAlign || 'top', titleWriting: d.titleWriting || 'horizontal', coverLayout: d.coverLayout || null,
        coverPos: d.coverPos, spinePos: d.spinePos,
        coverImageId: addImg(coverImageId(b)), spineImageId: addImg(d.spineImageId),
      },
    };
    if (images && !out.design.coverImageId) out.design.coverImageId = null;
    if (bodyIds.has(b.id) && eligible(b)) {
      out.body = arts.map((a) => {
        const t = document.createElement('template');
        const sp = splitHtml(a.html || '', markFor(b, a.id));
        t.innerHTML = sp.free; // the paid part is never included
        for (const img of $$('img[data-img]', t.content)) { if (!addImg(img.getAttribute('data-img'))) img.removeAttribute('data-img'); }
        return { title: a.title, url: a.url || null, html: t.innerHTML, ...(sp.cut ? { paidCut: true } : {}) };
      });
    }
    return out;
  });
  const ids2 = new Set(books.map((b) => b.id));
  return {
    shop: {
      name: shop.name, tagline: shop.tagline, owner: shop.owner, intro: intro ? shop.intro : '',
      profileUrl: shop.profileUrl || '', theme: shop.theme, featuredPop: shop.featuredPop || '',
      avatarImageId: intro ? addImg(shop.avatarImageId) : null,
      signFont: shop.signFont || 'mincho', seal: { text: (shop.seal && shop.seal.text) || '', show: !(shop.seal && shop.seal.show === false) },
      weathering: shop.weathering !== false, thickness: shop.thickness === 'length' ? 'length' : 'design', lighting: shop.lighting === 'off' ? 'off' : 'auto',
      monthly: shop.monthly && ids2.has(shop.monthly.bookId) ? { ...shop.monthly } : null,
    },
    shelves: usedShelves.map((s) => ({ id: s.id, name: s.name })),
    featured: shop.featured.filter((id) => ids2.has(id)),
    books, images: imgs,
  };
}

function previewList(model, { link }) {
  const withBody = model.books.filter((b) => b.body);
  return h('div', { class: 'note-box' },
    h('strong', null, '共有される内容の最終確認'),
    h('ul', { style: 'margin:6px 0 0;padding-left:1.2em;line-height:1.8;font-size:14px' },
      h('li', null, `店名「${model.shop.name}」・テーマ「${getTheme(model.shop.theme).name}」・店主名「${model.shop.owner || '（なし）'}」`),
      h('li', null, `自己紹介：${model.shop.intro ? 'あり' : 'なし'}／プロフィールURL：${model.shop.profileUrl || 'なし'}`),
      h('li', null, `本 ${model.books.length}冊（タイトル・noteのURL${model.books.some((b) => b.pop) ? '・POP' : ''}${model.books.some((b) => b.blurb) ? '・紹介文' : ''}${model.books.some((b) => b.forWhom) ? '・こんな人へ' : ''}）`),
      link ? h('li', null, '画像：含まれません（自分で登録した表紙・背表紙画像は相手には届かず、文字の表紙で表示されます）')
        : h('li', null, `画像：${model.images.size}枚`),
      h('li', null, withBody.length ? `本文：${withBody.map((b) => `「${b.title}」`).join('、')} の本文を含みます` : '本文：含まれません'),
      withBody.some((b) => b.body.some((c) => c.paidCut)) ? h('li', null, `有料部分：${withBody.filter((b) => b.body.some((c) => c.paidCut)).map((b) => `「${b.title}」`).join('、')} は有料部分の手前までです`) : null),
    h('p', { class: 'hint', style: 'margin:6px 0 0' }, `含まれる本：${model.books.map((b) => b.title).join(' ／ ') || 'なし'}`));
}

// ======================= B. link =======================
function b64url(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  if (!/^[A-Za-z0-9_-]+$/.test(str)) throw new Error('リンクに使えない文字が含まれています。');
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const u8 = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
  return u8;
}

export function encodeLink(model) {
  const shelfIdx = new Map(model.shelves.map((s, i) => [s.id, i]));
  const p = {
    v: 1, n: model.shop.name, t: model.shop.theme,
    ...(model.shop.tagline ? { g: model.shop.tagline } : {}), ...(model.shop.owner ? { o: model.shop.owner } : {}),
    ...(model.shop.intro ? { i: model.shop.intro } : {}), ...(model.shop.profileUrl ? { p: model.shop.profileUrl } : {}),
    ...(model.shop.featuredPop ? { fp: model.shop.featuredPop } : {}),
    s: model.shelves.map((s) => s.name),
    b: model.books.map((b) => {
      const o = { i: b.id, t: b.title, u: b.url, s: shelfIdx.get(b.shelfId) ?? 0 };
      if (b.spineTitle) o.x = b.spineTitle;
      if (b.face === 'cover') o.f = 1; else if (b.face === 'flat') o.f = 2; else if (b.face === 'lean') o.f = 3;
      if (b.obi && b.obi.text) o.ob = [b.obi.text, (b.obi.color || '').slice(1)];
      if (b.volumes) o.v = b.volumes;
      if (b.chars) o.n = b.chars;
      if (b.date) o.dt = b.date;
      if (b.kind !== 'single') o.k = b.kind === 'serial' ? 's' : 'a';
      if (b.chapters.length) o.c = b.chapters.map((c) => [c.title, c.url]);
      if (b.seriesStatus) o.st = b.seriesStatus === 'ongoing' ? 'o' : 'c';
      if (b.pop) { o.p = b.pop; if (!b.popOnShelf) o.ps = 0; }
      if (b.blurb) o.d = b.blurb;
      if (b.forWhom) o.w = b.forWhom;
      if (b.paidNote) o.pd = 1;
      const d = b.design;
      if (d.color) o.cl = d.color.slice(1);
      if (d.motif) o.m = d.motif;
      if (d.material) o.mt = d.material;
      if (d.spineStyle) o.ss = d.spineStyle;
      if (d.titleColor) o.tc = d.titleColor.slice(1);
      if (d.titleWriting === 'vertical') o.tv = 1;
      if (d.titleAlign && d.titleAlign !== 'top') o.ta = d.titleAlign;
      return o;
    }),
    r: model.featured.map((id) => model.books.findIndex((b) => b.id === id)).filter((i) => i >= 0),
    x: [model.shop.signFont, model.shop.seal.text, model.shop.seal.show ? 1 : 0, model.shop.weathering ? 1 : 0, model.shop.thickness === 'length' ? 1 : 0, model.shop.lighting === 'off' ? 0 : 1],
    ...(model.shop.monthly ? { mo: [model.books.findIndex((b) => b.id === model.shop.monthly.bookId), model.shop.monthly.month, model.shop.monthly.note || ''] } : {}),
  };
  const json = JSON.stringify(p);
  const data = b64url(deflateSync(strToU8(json), { level: 9 }));
  const base = location.origin + location.pathname;
  return { url: `${base}#s=${data}`, jsonLength: json.length, payload: p };
}

const MAX_LINK_JSON = 256 * 1024;
const sstr = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : '');

/** Decode + validate a shared link. Returns readonly data for state.loadReadonly. */
export async function readShareFromHash(str) {
  if (typeof str !== 'string' || str.length > 120000) throw new Error('リンクが長すぎます。');
  let json;
  try {
    const raw = unb64url(str);
    const buf = new Uint8Array(MAX_LINK_JSON);
    const out = inflateSync(raw, { out: buf });
    if (out.length >= MAX_LINK_JSON) throw new Error('too big');
    json = JSON.parse(strFromU8(out));
  } catch (e) { throw new Error('リンクの内容を読み取れませんでした。途中で切れている可能性があります。'); }
  if (!json || typeof json !== 'object' || json.v !== 1) throw new Error('対応していない形式のリンクです。');
  const shelves = (Array.isArray(json.s) ? json.s : []).slice(0, 50).map((n, i) => ({ id: 'sh' + i, name: sstr(n, 40) || '棚' }));
  shelves.push({ id: UNSORTED, name: 'その他' });
  const books = [];
  const seen = new Set();
  for (const [idx, o] of (Array.isArray(json.b) ? json.b : []).slice(0, 400).entries()) {
    if (!o || typeof o !== 'object') continue;
    const url = isNoteUrl(o.u) ? safeHttpUrl(o.u) : null;
    const title = sstr(o.t, 200);
    if (!title || !url) continue;
    let id = typeof o.i === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(o.i) ? o.i : 'x' + idx;
    if (seen.has(id)) id += '_' + idx;
    seen.add(id);
    const color = typeof o.cl === 'string' && /^[0-9a-f]{6}$/i.test(o.cl) ? '#' + o.cl : null;
    const b = newBook({
      id, title, url, spineTitle: sstr(o.x, 80) || null,
      shelfId: Number.isInteger(o.s) && o.s >= 0 && o.s < shelves.length - 1 ? 'sh' + o.s : UNSORTED,
      order: idx,
      ...cleanBookExtras({ face: [null, 'cover', 'flat', 'lean'][o.f] || 'spine', obi: Array.isArray(o.ob) ? { text: o.ob[0], color: o.ob[1] ? '#' + o.ob[1] : null } : null, volumes: o.v, chars: o.n, date: o.dt }),
      kind: o.k === 's' ? 'serial' : o.k === 'a' ? 'anthology' : 'single',
      seriesStatus: o.st === 'o' ? 'ongoing' : o.st === 'c' ? 'complete' : null,
      pop: sstr(o.p, 200), popOnShelf: o.ps !== 0, blurb: sstr(o.d, 800), forWhom: sstr(o.w, 200), paidNote: o.pd === 1, status: 'publish',
    });
    b.chapters = (Array.isArray(o.c) ? o.c : []).slice(0, 300).map((c) => Array.isArray(c) ? { title: sstr(c[0], 200), url: isNoteUrl(c[1]) ? safeHttpUrl(c[1]) : null } : null).filter(Boolean);
    Object.assign(b.design, {
      color, motif: MOTIFS.includes(o.m) || o.m === 'none' ? o.m : null,
      material: ['cloth', 'paper', 'leather', 'worn', 'matte'].includes(o.mt) ? o.mt : null,
      spineStyle: ['plain', 'bands', 'label', 'frame', 'ribs', 'line'].includes(o.ss) ? o.ss : null,
      titleColor: typeof o.tc === 'string' && /^[0-9a-f]{6}$/i.test(o.tc) ? '#' + o.tc : null,
      titleWriting: o.tv === 1 ? 'vertical' : 'horizontal', titleAlign: ['center', 'bottom'].includes(o.ta) ? o.ta : 'top',
      coverImageId: null, spineImageId: null,
    });
    books.push(b);
  }
  const shop = {
    key: 'shop', name: sstr(json.n, 60) || 'わたしの小さな本屋', tagline: sstr(json.g, 80), owner: sstr(json.o, 60), intro: sstr(json.i, 1200),
    profileUrl: isNoteUrl(json.p) ? safeHttpUrl(json.p) : '', theme: THEME_MAP[json.t] ? json.t : 'warm',
    featuredPop: sstr(json.fp, 40), avatarImageId: null, shelves,
    featured: (Array.isArray(json.r) ? json.r : []).filter((i) => Number.isInteger(i) && books[i]).slice(0, 3).map((i) => books[i].id),
  };
  const x = Array.isArray(json.x) ? json.x : [];
  const mo = Array.isArray(json.mo) && Number.isInteger(json.mo[0]) && books[json.mo[0]] ? { bookId: books[json.mo[0]].id, month: json.mo[1], note: json.mo[2] } : null;
  Object.assign(shop, cleanShopExtras({ signFont: x[0], seal: { text: x[1], show: x[2] !== 0 }, weathering: x[3] !== 0, thickness: x[4] === 1 ? 'length' : 'design', lighting: x[5] === 0 ? 'off' : 'auto', monthly: mo }, new Set(books.map((b) => b.id))));
  return { shop, books, articles: [], images: [] };
}

function openLinkShare() {
  const state = { sel: new Set(visibleBooks().filter(eligible).map((b) => b.id)), body: new Set() };
  const opts = { pop: true, blurb: true, intro: true };
  const result = h('div');
  const prev = h('div');
  const update = () => {
    const model = buildPublicModel({ ids: state.sel, ...opts, images: false });
    prev.replaceChildren(previewList(model, { link: true }));
    result.replaceChildren();
  };
  state.onChange = update;
  const opt = (label, key) => { const cb = h('input', { type: 'checkbox', checked: opts[key] || null }); cb.addEventListener('change', () => { opts[key] = cb.checked; update(); }); return h('label', { class: 'check' }, cb, h('span', null, label)); };
  const body = h('div', null,
    h('p', { class: 'hint' }, '選んだ本のタイトルとnoteのURLなど、軽いデータだけを圧縮してURLの「#」以降に入れます。データはサーバーに送られません。本文・画像は入りません。本屋を更新したら、リンクを作り直してください。'),
    opt('POPを含める', 'pop'), opt('紹介文・「こんな人へ」を含める', 'blurb'), opt('自己紹介を含める', 'intro'),
    h('h3', null, '共有する本'), bookSelector(state), prev, result);
  update();
  const m = openModal({
    title: 'B. 紹介リンクをつくる', body, wide: true,
    actions: [
      { label: '閉じる' },
      { label: 'この内容でリンクをつくる', primary: true, close: false, onClick: () => {
        const model = buildPublicModel({ ids: state.sel, ...opts, images: false });
        if (!model.books.length) { toast('本を1冊以上選んでください'); return false; }
        const { url } = encodeLink(model);
        if (url.length > LINK_MAX) {
          const per = url.length / model.books.length;
          const fit = Math.max(1, Math.floor((LINK_MAX - 400) / per));
          result.replaceChildren(h('p', { class: 'note-box warn', role: 'alert' }, `リンクが長すぎます（${url.length}文字／上限${LINK_MAX}文字）。本を${fit}冊くらいまで減らすか、紹介文・自己紹介を外してください。`));
          return false;
        }
        const ta = h('textarea', { class: 'text', readonly: true, rows: '3', style: 'font-size:12px' }); ta.value = url;
        result.replaceChildren(h('div', { class: 'note-box' },
          h('strong', null, `リンクができました（${url.length}文字）`),
          ta,
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' },
            btn('コピー', async () => { try { await navigator.clipboard.writeText(url); toast('コピーしました'); } catch { ta.select(); toast('選択しました。長押しでコピーしてください'); } }, { cls: 'primary small' }),
            navigator.share ? btn('共有…', () => navigator.share({ url, title: S.shop.name }).catch(() => {}), { cls: 'small', iconName: 'share' }) : null,
            h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, '開いて確認', icon('ext'))),
          h('p', { class: 'hint' }, '短縮URLは作りません。メッセージアプリによっては長いURLが途中で切れることがあります。その場合は本の数を減らしてください。')));
        return false;
      } },
    ],
  });
}

// ======================= C. publish ZIP =======================
const APP_FILES = [
  'app/css/app.css',
  ...['main', 'util', 'themes', 'db', 'state', 'shelf', 'bookview', 'ui', 'sample', 'editor', 'reader', 'share', 'import-ui', 'importer', 'sanitize', 'images', 'zipsafe', 'organize', 'backup', 'readtime', 'paywall', 'individual'].map((n) => `app/js/${n}.js`),
  'app/vendor/fflate.js', 'app/vendor/fflate.LICENSE',
  'assets/ui/bookend.svg', 'assets/ui/pop-dark.svg', 'assets/ui/pop-paper.svg', 'assets/ui/shelf-label.svg', 'assets/ui/icon.svg', 'assets/ui/icon-180.png',
];

function openPublishZip() {
  const state = { sel: new Set(visibleBooks().filter(eligible).map((b) => b.id)), body: new Set() };
  const opts = { pop: true, blurb: true, intro: true };
  const prev = h('div');
  const confirmBox = h('input', { type: 'checkbox' });
  const confirmWrap = h('label', { class: 'check' }, confirmBox, h('span', null, '本文を含める本に、有料部分や公開したくない内容が含まれていないことを確認しました'));
  const update = () => {
    const model = buildPublicModel({ ids: state.sel, bodyIds: state.body, ...opts, images: true });
    prev.replaceChildren(previewList(model, { link: false }));
    confirmWrap.hidden = !model.books.some((b) => b.body);
  };
  state.onChange = update;
  const opt = (label, key) => { const cb = h('input', { type: 'checkbox', checked: opts[key] || null }); cb.addEventListener('change', () => { opts[key] = cb.checked; update(); }); return h('label', { class: 'check' }, cb, h('span', null, label)); };
  const body = h('div', null,
    h('p', { class: 'hint' }, '選んだ本と画像、閲覧用ページをひとつのZIPにします。ZIPの中身をGitHub Pagesなどの静的ホスティングに置くと、画像込みの本屋として公開できます（置く作業は別途必要です）。編集用データや選ばなかった本・下書きは入りません。'),
    opt('POPを含める', 'pop'), opt('紹介文・「こんな人へ」を含める', 'blurb'), opt('自己紹介・プロフィール画像を含める', 'intro'),
    h('p', { class: 'note-box warn' }, '「本文も公開する」は最初はすべてオフです。noteの書き出しには有料部分の境界が含まれないため、有料記事の本文は含めないでください。'),
    h('h3', null, '公開する本'), bookSelector(state, { withBody: true }), prev, confirmWrap);
  update();
  openModal({
    title: 'C. 公開用ZIPをつくる', body, wide: true,
    actions: [
      { label: '閉じる' },
      { label: 'ZIPを作る', primary: true, onClick: async () => {
        const model = buildPublicModel({ ids: state.sel, bodyIds: state.body, ...opts, images: true });
        if (!model.books.length) { toast('本を1冊以上選んでください'); return false; }
        if (model.books.some((b) => b.body) && !confirmBox.checked) { toast('本文を含める場合は、確認のチェックを入れてください'); confirmBox.focus(); return false; }
        try { await buildPublishZip(model); } catch (e) { alertDialog(`ZIPを作れませんでした。${e.message || ''}`, 'エラー'); return false; }
      } },
    ],
  });
}

export async function buildPublishZip(model, { download = true } = {}) {
  const pd = download ? progressDialog('公開用ZIPを作っています') : null;
  try {
    const files = {};
    const theme = getTheme(model.shop.theme);
    const list = [...APP_FILES, theme.img];
    for (let i = 0; i < list.length; i++) {
      const res = await fetch(list[i], { cache: 'no-store' });
      if (!res.ok) throw new Error(`${list[i]} を読み込めませんでした（オフラインの可能性があります）`);
      files[list[i]] = new Uint8Array(await res.arrayBuffer());
      pd && pd.set(0.5 * (i / list.length), 'ページのファイルを集めています…');
    }
    let index = await (await fetch('index.html', { cache: 'no-store' })).text();
    index = index.replace('<head>', '<head>\n  <meta name="bookshop-mode" content="published">').replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(model.shop.name)}</title>`);
    files['index.html'] = strToU8(index);
    const imgMeta = [];
    let k = 0;
    for (const [id, img] of model.images) {
      const path = `images/${id}.${extFor(img.mime)}`;
      files[path] = [new Uint8Array(await img.blob.arrayBuffer()), { level: 0 }];
      imgMeta.push({ id, file: path, w: img.w, h: img.h });
      pd && pd.set(0.5 + 0.4 * (++k / model.images.size), `画像 ${k} / ${model.images.size}`);
    }
    const data = { app: 'little-bookshop-published', v: 1, generatedAt: new Date().toISOString(), shop: model.shop, shelves: model.shelves, featured: model.featured, books: model.books, images: imgMeta };
    files['data/shop.json'] = strToU8(JSON.stringify(data));
    files['README.txt'] = strToU8([
      `${model.shop.name} — 公開用ファイル`, '',
      'このフォルダの中身をそのまま静的ホスティング（GitHub Pages など）に置くと、本屋を公開できます。',
      'index.html のある場所を公開URLにしてください。ファイルを直接ダブルクリックしても表示されません（ブラウザの制限）。',
      '本屋を更新したときは、アプリで公開用ZIPを作り直し、中身を置き換えてください。', '',
      '含まれるもの：選んだ本のタイトル・noteのURL・装丁画像・POP・紹介文、本文を許可した本の本文のみ。',
      '編集用のデータ、選ばなかった本、下書きは含まれません。', '',
      'ライセンス：app/vendor/fflate.js は MIT License（app/vendor/fflate.LICENSE）。',
    ].join('\n'));
    pd && pd.set(0.95, 'ZIPにまとめています…');
    const zipped = zipSync(files, { level: 6 });
    pd && pd.close();
    const blob = new Blob([zipped], { type: 'application/zip' });
    if (download) {
      const r = await shareOrDownload(blob, 'bookshop-public.zip', model.shop.name);
      if (r !== 'cancelled') toast('公開用ZIPを書き出しました。中身を静的ホスティングに置くと公開できます。', 'info', 6000);
    }
    return blob;
  } catch (e) { pd && pd.close(); throw e; }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/** Published mode: load data/shop.json and validate it like any untrusted input. */
export async function loadPublishedData() {
  const res = await fetch('data/shop.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('data/shop.json が見つかりません。ZIPの中身をすべて置いたか確認してください。');
  const text = await res.text();
  if (text.length > 100 * 1024 * 1024) throw new Error('データが大きすぎます。');
  const j = JSON.parse(text);
  if (!j || j.app !== 'little-bookshop-published' || j.v !== 1) throw new Error('対応していないデータ形式です。');
  const images = (Array.isArray(j.images) ? j.images : []).filter((m) => m && /^[A-Za-z0-9_]{3,64}$/.test(m.id) && /^images\/[A-Za-z0-9_]+\.(png|jpg|gif|webp)$/.test(m.file))
    .map((m) => ({ id: m.id, url: m.file, w: Number(m.w) || 0, h: Number(m.h) || 0 }));
  const known = new Set(images.map((i) => i.id));
  const shelves = (Array.isArray(j.shelves) ? j.shelves : []).slice(0, 200).map((s) => ({ id: sstr(s && s.id, 40) || UNSORTED, name: sstr(s && s.name, 40) || '棚' }));
  if (!shelves.some((s) => s.id === UNSORTED)) shelves.push({ id: UNSORTED, name: 'その他' });
  const articles = [];
  const books = (Array.isArray(j.books) ? j.books : []).slice(0, 5000).filter((b) => b && typeof b.id === 'string').map((o, idx) => {
    const id = sstr(o.id, 60).replace(/[^A-Za-z0-9_]/g, '') || 'b' + idx;
    const d = o.design || {};
    const pos = (p) => ({ x: clamp(Number(p && p.x) || 50, 0, 100), y: clamp(Number(p && p.y) || 50, 0, 100), s: clamp(Number(p && p.s) || 1, 1, 3) });
    const b = newBook({
      id, title: sstr(o.title, 300) || '無題', spineTitle: sstr(o.spineTitle, 80) || null,
      kind: ['single', 'serial', 'anthology'].includes(o.kind) ? o.kind : 'single', mode: o.mode === 'novel' ? 'novel' : 'post',
      writing: o.writing === 'vertical' ? 'vertical' : 'horizontal', shelfId: shelves.some((s) => s.id === o.shelfId) ? o.shelfId : UNSORTED,
      order: Number(o.order) || idx,
      ...cleanBookExtras(o),
      seriesStatus: ['ongoing', 'complete'].includes(o.seriesStatus) ? o.seriesStatus : null,
      url: isNoteUrl(o.url) ? safeHttpUrl(o.url) : null, pop: sstr(o.pop, 200), popOnShelf: o.popOnShelf !== false, blurb: sstr(o.blurb, 1000), forWhom: sstr(o.forWhom, 200), paidNote: o.paidNote === true,
      shareBody: Array.isArray(o.body) && o.body.length > 0,
    });
    b.chapters = (Array.isArray(o.chapters) ? o.chapters : []).slice(0, 500).map((c) => ({ title: sstr(c && c.title, 200), url: isNoteUrl(c && c.url) ? safeHttpUrl(c.url) : null }));
    Object.assign(b.design, {
      color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : null, material: ['cloth', 'paper', 'leather', 'worn', 'matte'].includes(d.material) ? d.material : null,
      motif: MOTIFS.includes(d.motif) || d.motif === 'none' ? d.motif : null, spineStyle: ['plain', 'bands', 'label', 'frame', 'ribs', 'line'].includes(d.spineStyle) ? d.spineStyle : null,
      showTitle: d.showTitle !== false, showAuthor: d.showAuthor !== false, titleColor: /^#[0-9a-f]{6}$/i.test(d.titleColor) ? d.titleColor : null,
      titleAlign: ['top', 'center', 'bottom'].includes(d.titleAlign) ? d.titleAlign : 'top', titleWriting: d.titleWriting === 'vertical' ? 'vertical' : 'horizontal',
      coverLayout: ['full', 'plate'].includes(d.coverLayout) ? d.coverLayout : null, coverPos: pos(d.coverPos), spinePos: pos(d.spinePos),
      coverImageId: known.has(d.coverImageId) ? d.coverImageId : null, spineImageId: known.has(d.spineImageId) ? d.spineImageId : null,
    });
    if (b.shareBody) {
      b.articleIds = o.body.slice(0, 500).map((c, i) => {
        const aid = `${id}_c${i}`;
        articles.push({ id: aid, title: sstr(c && c.title, 300), url: isNoteUrl(c && c.url) ? safeHttpUrl(c.url) : null, status: 'publish', paidCut: !!(c && c.paidCut), html: sanitizeHtml(sstr(c && c.html, 5_000_000), { knownImage: (x) => known.has(x) }).html });
        return aid;
      });
    }
    return b;
  });
  const ids = new Set(books.map((b) => b.id));
  const s = j.shop || {};
  const shop = {
    key: 'shop', name: sstr(s.name, 60) || 'わたしの小さな本屋', tagline: sstr(s.tagline, 80), owner: sstr(s.owner, 60), intro: sstr(s.intro, 2000),
    profileUrl: isNoteUrl(s.profileUrl) ? safeHttpUrl(s.profileUrl) : '', theme: THEME_MAP[s.theme] ? s.theme : 'warm', featuredPop: sstr(s.featuredPop, 40),
    avatarImageId: known.has(s.avatarImageId) ? s.avatarImageId : null, shelves,
    featured: (Array.isArray(j.featured) ? j.featured : []).filter((x) => ids.has(x)).slice(0, 3),
  };
  Object.assign(shop, cleanShopExtras(s, ids));
  return { shop, books, articles, images };
}

// ======================= A. shelf image =======================
function openImageExport() {
  const shelves = orderedShelves().filter((s) => booksOnShelf(s.id).length);
  const sel = new Set(shelves.map((s) => s.id));
  let feat = S.shop.featured.length > 0;
  let header = true;
  const out = h('div');
  const body = h('div', null,
    h('p', { class: 'hint' }, '選んだ棚を、店名と一緒に一枚の画像にします。下書きを含む本は描かれません。縦に長くなる場合は複数枚に分けます。'),
    (() => { const cb = h('input', { type: 'checkbox', checked: header || null }); cb.addEventListener('change', () => { header = cb.checked; }); return h('label', { class: 'check' }, cb, h('span', null, '店名を入れる')); })(),
    S.shop.featured.length ? (() => { const cb = h('input', { type: 'checkbox', checked: feat || null }); cb.addEventListener('change', () => { feat = cb.checked; }); return h('label', { class: 'check' }, cb, h('span', null, '「初めての方へ」の3冊を入れる')); })() : null,
    h('h3', null, '描く棚'),
    ...shelves.map((s) => { const cb = h('input', { type: 'checkbox', checked: true }); cb.addEventListener('change', () => { if (cb.checked) sel.add(s.id); else sel.delete(s.id); }); return h('label', { class: 'check' }, cb, h('span', null, `${s.name}（${booksOnShelf(s.id).filter(eligible).length}冊）`)); }),
    out);
  openModal({
    title: 'A. 本棚の画像を保存', body, wide: true,
    actions: [{ label: '閉じる' }, { label: '画像をつくる', primary: true, onClick: async () => {
      out.replaceChildren(h('p', { class: 'hint' }, '描いています…'));
      try {
        const blobs = await paintShop({ shelfIds: [...sel], featured: feat, header });
        if (!blobs.length) { out.replaceChildren(h('p', { class: 'note-box warn' }, '描ける本がありません（公開済みの本だけが描かれます）。')); return false; }
        out.replaceChildren(h('p', { class: 'note-box' }, 'iPhone・iPadでは、画像を長押しして「写真に保存」または「共有」できます。'),
          ...blobs.map((b, i) => {
            const url = URL.createObjectURL(b);
            return h('figure', { style: 'margin:0 0 16px' }, h('img', { src: url, alt: `本棚の画像 ${i + 1}`, style: 'width:100%;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25)' }),
              h('figcaption', { style: 'display:flex;gap:8px;align-items:center;margin-top:6px' }, `${blobs.length > 1 ? `${i + 1}枚目・` : ''}${Math.round(b.size / 1024)}KB`,
                btn('保存・共有', () => shareOrDownload(b, `bookshop-${i + 1}.jpg`, S.shop.name), { cls: 'small primary', iconName: 'download' })));
          }));
      } catch (e) { console.error(e); out.replaceChildren(h('p', { class: 'note-box warn' }, `画像を作れませんでした：${e.message || e}`)); }
      return false;
    } }],
  });
}

const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('画像を読み込めません: ' + src)); i.src = src; });

export async function paintShop({ shelfIds, featured, header }) {
  const theme = getTheme(S.shop.theme);
  const W = 1500, pad = 36, inner = W - pad * 2;
  const g = geometry(inner, theme);
  const [shelfImg, labelImg] = await Promise.all([loadImage(theme.img), loadImage('assets/ui/shelf-label.svg')]);
  const segs = [];
  prepareFade();
  if (header) segs.push({ type: 'header', h: 150 });
  const pick = monthlyPick();
  if (pick && eligible(pick.book)) segs.push({ type: 'monthly', h: g.H, book: pick.book, label: `店主の${monthLabel(pick.month)}の一冊` });
  const feat = featured ? S.shop.featured.map((id) => S.books.get(id)).filter((b) => b && !b.hidden && eligible(b)) : [];
  if (feat.length) segs.push({ type: 'featured', h: g.H, books: feat });
  for (const s of orderedShelves().filter((x) => shelfIds.includes(x.id))) {
    const books = booksOnShelf(s.id).filter(eligible);
    if (!books.length) continue;
    const bays = packBays(buildItems(books, g).filter((it) => it.kind !== 'pop'), g);
    bays.forEach((items, i) => segs.push({ type: 'bay', h: g.H, items, label: i === 0 ? s.name : null }));
  }
  if (!segs.some((s) => s.type !== 'header')) return [];
  const MAXH = 4000;
  const pages = [[]];
  let ph = pad;
  for (const s of segs) {
    if (ph + s.h + pad > MAXH && pages[pages.length - 1].length) { pages.push([]); ph = pad; }
    pages[pages.length - 1].push(s); ph += s.h;
  }
  const blobs = [];
  for (const page of pages) {
    const H = pad * 2 + page.reduce((n, s) => n + s.h, 0);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    // case frame
    c.fillStyle = theme.ui.frame; c.fillRect(0, 0, W, H);
    const fr = c.createLinearGradient(0, 0, W, 0);
    fr.addColorStop(0, 'rgba(0,0,0,.35)'); fr.addColorStop(0.02, 'rgba(255,255,255,.06)'); fr.addColorStop(0.98, 'rgba(255,255,255,.06)'); fr.addColorStop(1, 'rgba(0,0,0,.35)');
    c.fillStyle = fr; c.fillRect(0, 0, W, H);
    let y = pad;
    for (const s of page) {
      if (s.type === 'header') { paintHeader(c, theme, pad, y, inner, s.h); }
      else {
        c.drawImage(shelfImg, theme.imgW * (1 - 1 / g.zoom) / 2, theme.imgH * g.cropTop, theme.imgW / g.zoom, theme.imgH * (1 - g.cropTop), pad, y, inner, g.H);
        const sh = c.createLinearGradient(0, y, 0, y + g.H * 0.16);
        sh.addColorStop(0, 'rgba(0,0,0,.42)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = sh; c.fillRect(pad, y, inner, g.H * 0.16);
        const baseY = y + g.H - g.rowBottom;
        if (s.type === 'monthly') {
          const size = coverSize(g, 0.95);
          const x = pad + (inner - size.w) / 2;
          await paintCover(c, s.book, theme, x, baseY - 4 - size.h, size.w, size.h);
          paintStand(c, theme, x, baseY - 8, size.w);
          paintLabel(c, labelImg, s.label, pad + inner * 0.045, y + g.labelTop, g.labelH);
        } else if (s.type === 'featured') {
          const size = coverSize(g, 0.9);
          const gap = inner * 0.05;
          const total = s.books.length * size.w + (s.books.length - 1) * gap;
          let x = pad + (inner - total) / 2;
          for (const b of s.books) { await paintCover(c, b, theme, x, baseY - 4 - size.h, size.w, size.h); paintStand(c, theme, x, baseY - 8, size.w); x += size.w + gap; }
          paintLabel(c, labelImg, '初めての方へ', pad + inner * 0.045, y + g.labelTop, g.labelH);
        } else {
          // same arrangement as the screen: centred group between bookends when it doesn't fill the bay
          let used = 0;
          s.items.forEach((it, j) => { used += it.w + itemGap(s.items[j - 1], it, g); });
          const bw = bookendW(g), beH = clamp(g.maxBookH * 0.42, 34, 96);
          const ends = g.rowW - used > bw * 2 + 6;
          let x = pad + inner * 0.035 + (ends ? (g.rowW - used - bw * 2 - 2) / 2 : 0);
          if (ends) { paintBookend(c, x, baseY - beH, bw, beH); x += bw + 1; }
          s.items.forEach((it, j) => { x += itemGap(s.items[j - 1], it, g); it._x = x; x += it.w; });
          for (const it of s.items) {
            const ix = it._x;
            if (it.kind === 'pile') {
              let yy = baseY;
              it.entries.forEach((e, i) => { yy -= e.size.h; paintFlat(c, e.b, theme, ix + 4 + ((i * 37) % 7) - 3, yy, e.size.w, e.size.h, e.vol); });
              if (it.cover) {
                const cx = ix + (it.w - it.cover.w) / 2;
                c.save(); c.translate(cx + it.cover.w / 2, yy); c.rotate(-1.5 * Math.PI / 180);
                await paintCover(c, it.b, theme, -it.cover.w / 2, -it.cover.h, it.cover.w, it.cover.h);
                c.restore();
              }
            } else if (it.face === 'cover') await paintCover(c, it.b, theme, ix, baseY - it.size.h, it.size.w, it.size.h);
            else if (it.lean) {
              c.save(); c.translate(ix + it.size.w, baseY); c.rotate(6 * Math.PI / 180);
              await paintSpine(c, it.b, theme, -it.size.w, -it.size.h, it.size.w, it.size.h, it.vol);
              c.restore();
            } else await paintSpine(c, it.b, theme, ix, baseY - it.size.h, it.size.w, it.size.h, it.vol);
          }
          if (ends) paintBookend(c, x + 1, baseY - beH, bw, beH);
          if (s.label) paintLabel(c, labelImg, s.label, pad + inner * 0.045, y + g.labelTop, g.labelH);
        }
      }
      y += s.h;
    }
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
    cv.width = cv.height = 0;
    if (!blob) throw new Error('画像の書き出しに失敗しました（メモリ不足の可能性）');
    blobs.push(blob);
  }
  return blobs;
}

const SERIF = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Noto Serif CJK JP","IPAMincho",serif';

function paintHeader(c, theme, x, y, w, hh) {
  c.fillStyle = theme.ui.paper; c.fillRect(x, y, w, hh - 10);
  c.fillStyle = theme.ui.ink; c.textBaseline = 'middle'; c.textAlign = 'left';
  c.font = `600 52px ${SERIF}`;
  const name = S.shop.name || 'わたしの小さな本屋';
  c.fillText(name, x + 40, y + (S.shop.tagline ? 58 : 70));
  if (S.shop.tagline) { c.font = `26px ${SERIF}`; c.fillStyle = theme.ui.sub; c.fillText(S.shop.tagline, x + 42, y + 106); }
  const st = (S.shop.seal && S.shop.seal.show === false) ? '' : sealText();
  if (st) {
    const sz = 84, sx = x + w - sz - 40, sy = y + (hh - 10 - sz) / 2;
    c.save(); c.translate(sx + sz / 2, sy + sz / 2); c.rotate(-4 * Math.PI / 180);
    c.strokeStyle = '#b8322a'; c.lineWidth = 4; c.strokeRect(-sz / 2, -sz / 2, sz, sz);
    c.fillStyle = '#b8322a'; c.font = `800 ${Array.from(st).length <= 2 ? 32 : 28}px ${SERIF}`;
    const ch = Array.from(st);
    const cols = ch.length <= 2 ? [ch] : [ch.slice(0, 2), ch.slice(2)];
    cols.forEach((col, ci) => drawVertical(c, col.join(''), (cols.length === 1 ? 0 : ci === 0 ? 16 : -16), -(col.length * 30) / 2, 30, 1, 200));
    c.restore();
  }
}

function paintLabel(c, img, text, x, y, hgt) {
  const fs = clamp(hgt * 0.5, 12, 26) * 1.6;
  const H = hgt * 1.6;
  c.font = `600 ${fs}px ${SERIF}`;
  const tw = Math.min(c.measureText(text).width, 600);
  const w = tw + fs * 3;
  c.drawImage(img, x, y - H * 0.48 - (H - hgt) / 2, w, H * 1.96);
  c.fillStyle = '#3b2f22'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, x + w / 2, y + hgt / 2, tw);
}

function paintStand(c, theme, x, y, w) {
  const gr = c.createLinearGradient(0, y, 0, y + 14);
  gr.addColorStop(0, '#c99a62'); gr.addColorStop(1, '#6d4a2b');
  c.fillStyle = gr; c.fillRect(x - w * 0.03, y, w * 1.06, 14);
}

function shadowUnder(c, x, y, w) {
  const gr = c.createRadialGradient(x + w * 0.45, y, 1, x + w * 0.45, y, w * 0.8);
  gr.addColorStop(0, 'rgba(0,0,0,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = gr; c.fillRect(x - w * 0.2, y - 6, w * 1.5, 14);
}

function paintBookend(c, x, y, w, hh) {
  const gr = c.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, '#5d4029'); gr.addColorStop(0.55, '#b58a54'); gr.addColorStop(1, '#715035');
  c.fillStyle = gr; c.fillRect(x, y, w, hh);
}
function paintFade(c, b, x, y, w, hh) {
  const f = fadeOf(b);
  if (f > 0.005) { c.fillStyle = `rgba(236, 224, 196, ${(f * 0.75).toFixed(3)})`; c.fillRect(x, y, w, hh); }
}
function paintFlat(c, b, theme, x, y, w, hh, vol) {
  const look = bookLook(b, theme);
  c.save();
  roundRect(c, x, y, w, hh, 2); c.clip();
  c.fillStyle = look.color; c.fillRect(x, y, w, hh);
  const gr = c.createLinearGradient(0, y, 0, y + hh);
  gr.addColorStop(0, 'rgba(255,255,255,.2)'); gr.addColorStop(0.6, 'rgba(0,0,0,.04)'); gr.addColorStop(1, 'rgba(0,0,0,.32)');
  c.fillStyle = gr; c.fillRect(x, y, w, hh);
  const obi = obiOf(b);
  if (obi) { c.fillStyle = obi.color; c.fillRect(x + w * 0.74, y, w * 0.18, hh); }
  c.fillStyle = look.ink; c.font = `600 ${clamp(Math.floor(hh * 0.5), 10, 18)}px ${SERIF}`; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText(spineTitle(b) + (vol ? `　${vol}` : ''), x + 12, y + hh / 2, w * (obi ? 0.6 : 0.85));
  paintFade(c, b, x, y, w, hh);
  c.restore();
}

async function paintSpine(c, b, theme, x, y, w, ht, vol) {
  const look = bookLook(b, theme);
  shadowUnder(c, x, y + ht, w);
  c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(x + w, y + 6, 8, ht - 6);
  c.save();
  roundRect(c, x, y, w, ht, 3); c.clip();
  c.fillStyle = look.color; c.fillRect(x, y, w, ht);
  if (b.design.spineImageId && S.images.get(b.design.spineImageId)?.blob) await drawCover(c, S.images.get(b.design.spineImageId), b.design.spinePos, x, y, w, ht);
  const gr = c.createLinearGradient(x, 0, x + w, 0);
  [[0, 'rgba(0,0,0,.40)'], [0.09, 'rgba(0,0,0,.08)'], [0.22, 'rgba(255,255,255,.17)'], [0.42, 'rgba(255,255,255,.05)'], [0.66, 'rgba(0,0,0,.03)'], [0.92, 'rgba(0,0,0,.26)'], [1, 'rgba(0,0,0,.46)']].forEach(([o, col]) => gr.addColorStop(o, col));
  c.fillStyle = gr; c.fillRect(x, y, w, ht);
  c.strokeStyle = look.ink; c.globalAlpha = 0.65; c.lineWidth = 1.2;
  if (look.spineStyle === 'bands' || look.spineStyle === 'ribs') {
    for (const yy of [y + ht * 0.09, y + ht * 0.09 + 6, y + ht * 0.9, y + ht * 0.9 - 6]) { c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); }
  }
  c.globalAlpha = 1;
  const t = spineTitle(b);
  const fit = spineFit(t, w, ht, look.spineStyle);
  let ty = y + ht * (look.spineStyle === 'label' || look.spineStyle === 'frame' ? 0.16 : 0.12);
  if (look.spineStyle === 'label') {
    const lh = Math.min(fit.maxH, textUnits(fit.text) / fit.cols * fit.fs * 1.04) + 16;
    c.fillStyle = '#efe6d1'; c.fillRect(x + 3, ty - 8, w - 6, lh);
    c.strokeStyle = 'rgba(80,60,40,.4)'; c.strokeRect(x + 5, ty - 6, w - 10, lh - 4);
  }
  c.fillStyle = look.spineStyle === 'label' ? '#3b3026' : look.ink;
  c.font = `600 ${fit.fs}px ${SERIF}`;
  drawVertical(c, fit.text, x + w / 2, ty, fit.fs, fit.cols, fit.maxH);
  const obi = obiOf(b);
  if (obi) { c.fillStyle = obi.color; c.fillRect(x, y + ht * 0.86, w, ht * 0.14); }
  if (vol) {
    const r = Math.min(w * 0.32, 12), cy = y + ht * (obi ? 0.8 : 0.9);
    c.strokeStyle = look.ink; c.lineWidth = 1; c.beginPath(); c.arc(x + w / 2, cy, r, 0, Math.PI * 2); c.stroke();
    c.fillStyle = look.ink; c.font = `700 ${Math.round(r * 1.1)}px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(vol, x + w / 2, cy + 1);
  }
  paintFade(c, b, x, y, w, ht);
  c.restore();
}

const ROTATE = /[ー〜～—–\-…‥()（）「」『』【】［］\[\]<>〈〉《》｛｝{}=＝→←:：;；|｜]/;
function drawVertical(c, text, cx, top, fs, cols, maxH) {
  const chars = Array.from(text);
  const colGap = fs * 1.2;
  let col = 0, y = top;
  const x0 = cols === 2 ? cx + colGap / 2 : cx;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const ascii = ch.charCodeAt(0) < 0x80;
    const adv = ascii ? c.measureText(ch).width : fs * 1.04;
    if (y + adv > top + maxH && col < cols - 1) { col++; y = top; }
    const x = x0 - col * colGap;
    if (ascii && /[A-Za-z0-9.,!?'"&%#@]/.test(ch) || ROTATE.test(ch)) {
      c.save(); c.translate(x, y + adv / 2); c.rotate(Math.PI / 2); c.fillText(ch, 0, 0); c.restore();
    } else if ('、。，．'.includes(ch)) {
      c.fillText(ch, x + fs * 0.32, y + adv / 2 - fs * 0.3);
    } else if ('っゃゅょぁぃぅぇぉッャュョァィゥェォ'.includes(ch)) {
      c.fillText(ch, x + fs * 0.08, y + adv / 2 - fs * 0.06);
    } else c.fillText(ch, x, y + adv / 2);
    y += adv;
  }
}

async function drawCover(c, img, pos, x, y, w, ht) {
  const src = img.blob ? await createImageBitmap(img.blob) : await loadImage(img.url);
  const p = pos || { x: 50, y: 50, s: 1 };
  const iw = src.width, ih = src.height;
  const scale = Math.max(w / iw, ht / ih) * (p.s || 1);
  const dw = iw * scale, dh = ih * scale;
  const dx = x + (w - dw) * (p.x / 100), dy = y + (ht - dh) * (p.y / 100);
  c.drawImage(src, dx, dy, dw, dh);
  if (src.close) src.close();
}

async function paintCover(c, b, theme, x, y, w, ht) {
  const look = bookLook(b, theme);
  shadowUnder(c, x, y + ht, w);
  c.fillStyle = '#efe5cf'; c.fillRect(x + w - 2, y + 4, 7, ht - 5); // fore-edge pages
  c.save();
  roundRect(c, x, y, w, ht, 4); c.clip();
  c.fillStyle = look.color; c.fillRect(x, y, w, ht);
  const layout = coverLayout(b);
  const imgId = coverImageId(b);
  const d = b.design;
  if (layout === 'full' && imgId) await drawCover(c, S.images.get(imgId), d.coverPos, x, y, w, ht);
  else if (layout === 'plate' && imgId) {
    const px = x + w * 0.14, pw = w * 0.77, phh = pw / 1.42, py = y + ht * 0.41;
    c.fillStyle = '#f8f0dc'; c.fillRect(px - 4, py - 4, pw + 8, phh + 8);
    c.save(); c.beginPath(); c.rect(px, py, pw, phh); c.clip(); await drawCover(c, S.images.get(imgId), d.coverPos, px, py, pw, phh); c.restore();
  } else if (d.motif !== 'none') {
    const m = motifSvg(look.motif, look);
    if (m) {
      m.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      m.setAttribute('width', String(Math.round(w))); m.setAttribute('height', String(Math.round(ht * 0.58)));
      const s = new XMLSerializer().serializeToString(m).replace(/var\(--m1\)/g, look.m1).replace(/var\(--m2\)/g, look.m2).replace(/var\(--ink\)/g, look.ink);
      const url = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }));
      try { const im = await loadImage(url); c.drawImage(im, x, y + ht * 0.42, w, ht * 0.58); } catch { /* skip motif */ }
      URL.revokeObjectURL(url);
    }
  }
  const hg = c.createLinearGradient(x, 0, x + w, 0);
  [[0, 'rgba(0,0,0,.30)'], [0.026, 'rgba(255,255,255,.2)'], [0.048, 'rgba(0,0,0,.18)'], [0.09, 'rgba(0,0,0,0)'], [0.96, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.18)']].forEach(([o, col]) => hg.addColorStop(o, col));
  c.fillStyle = hg; c.fillRect(x, y, w, ht);
  if (d.showTitle !== false) {
    const full = layout === 'full' && imgId;
    if (full) { const sg = c.createLinearGradient(0, y, 0, y + ht * 0.55); sg.addColorStop(0, 'rgba(0,0,0,.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = sg; c.fillRect(x, y, w, ht * 0.55); }
    c.fillStyle = full ? '#fff' : look.ink;
    const ct = coverTitle(b);
    const fs = clamp(w * 0.105, 12, 40) * (textUnits(ct) > 22 ? 0.82 : 1);
    c.font = `600 ${fs}px ${SERIF}`;
    if (d.titleWriting === 'vertical') drawVertical(c, ct, x + w * 0.7, y + ht * 0.09, fs, 2, ht * 0.7);
    else {
      const lines = wrapLines(c, ct, w * 0.76).slice(0, layout === 'plate' && imgId ? 3 : 4);
      c.textAlign = 'center'; c.textBaseline = 'top';
      const ty = d.titleAlign === 'center' ? y + ht * 0.3 : d.titleAlign === 'bottom' ? y + ht * 0.84 - lines.length * fs * 1.5 : y + ht * 0.1;
      lines.forEach((l, i) => c.fillText(l, x + w * 0.54, ty + i * fs * 1.5));
    }
  }
  const obi = obiOf(b);
  if (obi) {
    const oy = y + ht * 0.77;
    c.fillStyle = obi.color; c.fillRect(x, oy, w, ht * 0.23);
    c.fillStyle = obi.ink; c.font = `700 ${clamp(w * 0.074, 9, 26)}px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const lines = wrapLines(c, obi.text, w * 0.78).slice(0, 2);
    lines.forEach((l, i) => c.fillText(l, x + w * 0.54, oy + ht * 0.115 + (i - (lines.length - 1) / 2) * clamp(w * 0.074, 9, 26) * 1.3));
  }
  paintFade(c, b, x, y, w, ht);
  if (d.showAuthor !== false && S.shop.owner && !obi) {
    c.font = `${Math.max(9, w * 0.062)}px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillStyle = layout === 'full' && imgId ? '#fff' : look.ink; c.globalAlpha = 0.85;
    c.fillText(S.shop.owner, x + w * 0.54, y + ht * 0.955, w * 0.8); c.globalAlpha = 1;
  }
  c.restore();
}

function wrapLines(c, text, maxW) {
  const lines = []; let cur = '';
  for (const ch of Array.from(text)) {
    if (c.measureText(cur + ch).width > maxW && cur) {
      if ('、。」）』！？'.includes(ch)) { cur += ch; lines.push(cur); cur = ''; continue; }
      lines.push(cur); cur = ch;
    } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

function roundRect(c, x, y, w, hh, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + hh); c.lineTo(x, y + hh); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
