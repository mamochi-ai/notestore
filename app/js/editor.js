// Owner-side editing UI.
import { h, toast, clamp, formatDate, $$, isNoteUrl, safeHttpUrl } from './util.js';
import { openModal, confirmDialog, alertDialog, icon, btn } from './ui.js';
import { THEMES, getTheme, MATERIALS, inkFor } from './themes.js';
import {
  S, UNSORTED, newBook, saveBooks, saveShop, saveAll, deleteBooks, booksOnShelf, visibleBooks, bookArticles,
  bookStatus, STATUS_LABEL, coverImageId, imageUrl, referencedImageIds, byOrder, shelfExists,
} from './state.js';
import { render, view, nudgeBook, dropBook, selectBook } from './shelf.js';
import { renderSpine, renderCover, autoSpineTitle, coverLayout, SPINE_STYLE_NAMES, MOTIFS, MOTIF_NAMES, bookLook } from './bookview.js';
import { intakeFile, ImageRejected } from './images.js';
import { suggestSeries, suggestShelves, matchKeywords } from './organize.js';
import { startImport } from './import-ui.js';
import { exportBackup, openRestore } from './backup.js';
import { storageInfo } from './db.js';
import { uid } from './util.js';

const rerender = () => render();

// ================= panel tools =================
export function bookTools(b, ctx) {
  const featured = S.shop.featured.includes(b.id);
  const shelfSel = h('select', { 'aria-label': '移動先の棚' },
    ...orderedShelves().map((s) => h('option', { value: s.id, selected: (shelfExists(b.shelfId) ? b.shelfId : UNSORTED) === s.id || null }, s.name)));
  shelfSel.addEventListener('change', async () => {
    await dropBook(b.id, shelfSel.value, null);
    toast(`「${S.shop.shelves.find((s) => s.id === shelfSel.value).name}」の棚へ移動しました`);
    selectBook(b.id);
  });
  const box = h('div', { class: 'edit-tools', role: 'group', 'aria-label': 'この本の編集' },
    btn('装丁・POPを編集', () => openDesignEditor(b, ctx), { cls: 'primary', iconName: 'edit' }),
    h('div', { class: 'row' },
      btn(b.face === 'cover' ? '背表紙向きにする' : '表紙向きにする', async () => { b.face = b.face === 'cover' ? 'spine' : 'cover'; await saveBooks([b]).catch(() => {}); rerender(); }, { cls: 'small' }),
      btn(featured ? 'おすすめから外す' : `おすすめに飾る（${S.shop.featured.length}/3）`, async () => {
        if (featured) S.shop.featured = S.shop.featured.filter((x) => x !== b.id);
        else {
          if (S.shop.featured.length >= 3) { toast('おすすめは3冊までです。先に1冊外してください。'); return; }
          S.shop.featured.push(b.id);
        }
        await saveShop().catch(() => {});
        rerender();
      }, { cls: 'small' })),
    h('div', { class: 'row' }, h('label', null, '移動先', shelfSel)),
    h('div', { class: 'row' },
      btn('前へ', () => nudgeBook(b.id, -1), { cls: 'small', iconName: 'left', attrs: { 'data-nudge': '-1' } }),
      btn('後ろへ', () => nudgeBook(b.id, 1), { cls: 'small', iconName: 'right', attrs: { 'data-nudge': '1' } }),
      h('span', { class: 'hint', style: 'margin:0' }, '長押し（PCはドラッグ）でも並べ替えできます')),
    h('div', { class: 'row' },
      b.kind === 'single'
        ? btn('連載・短編集にまとめる', () => openSeriesEditor({ preselect: [b.articleIds[0]] }), { cls: 'small', iconName: 'layers' })
        : btn('章・収録作品を編集', () => openSeriesEditor({ book: b }), { cls: 'small', iconName: 'layers' }),
      b.kind !== 'single' ? btn('まとめを解除', () => dissolveSeries(b), { cls: 'small' }) : null,
      btn('本を削除', () => removeBook(b), { cls: 'small danger', iconName: 'trash' })),
  );
  return box;
}

function orderedShelves() {
  return [...S.shop.shelves.filter((s) => s.id !== UNSORTED), ...S.shop.shelves.filter((s) => s.id === UNSORTED)];
}

async function removeBook(b) {
  const ok = await confirmDialog(`「${b.title}」を本棚から削除しますか？\n取り込んだ記事は残るので、「本と連載」からもう一度本にできます。`, { ok: '削除する', danger: true });
  if (!ok) return;
  if (b.kind !== 'single') {
    const restore = [...S.books.values()].filter((x) => x.mergedInto === b.id).map((x) => ({ ...x, hidden: false, mergedInto: null }));
    await saveBooks(restore).catch(() => {});
  }
  view.selected = null;
  await deleteBooks([b.id]).catch(() => {});
  rerender();
}

// ================= import =================
export function openImportPicker(ctx) {
  const input = h('input', { type: 'file', accept: '.zip,.xml,application/zip,application/xml,text/xml', class: 'visually-hidden' });
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const f = input.files[0];
    input.remove();
    if (f) startImport(f, { onDone: ctx.afterImport });
  });
  input.click();
  setTimeout(() => { if (input.isConnected && !input.files.length) { /* keep until change; iOS may delay */ } }, 0);
}

// ================= organize suggestions =================
export function openOrganizeSuggestions({ onDone, quietIfEmpty }) {
  const books = visibleBooks().filter((b) => b.kind === 'single');
  const art = (b) => S.articles.get(b.articleIds[0]);
  const series = suggestSeries(books, art);
  const shelves = suggestShelves(books.filter((b) => b.shelfId === UNSORTED || !shelfExists(b.shelfId)), art)
    .filter((s) => !S.shop.shelves.some((x) => x.name === s.name));
  if (!series.length && !shelves.length) {
    if (quietIfEmpty) { onDone && onDone(); return; }
    alertDialog('いまの本からは、まとめや棚分けの提案は見つかりませんでした。', '整理の提案').then(() => onDone && onDone());
    return;
  }
  const sChecks = series.map((g) => ({ g, on: false, title: g.title }));
  const shChecks = shelves.map((g) => ({ g, on: false, name: g.name }));
  const body = h('div', null,
    h('p', { class: 'hint' }, 'タイトルの共通部分や「第N話」「Vol.N」「#N」、先頭の【見出し】から機械的に見つけた候補です。正しいとは限りません。使うものだけ選んでください（あとからいつでも変更できます）。'),
    series.length ? h('h3', null, '連載としてまとめる候補') : null,
    ...sChecks.map((c) => {
      const cb = h('input', { type: 'checkbox' });
      cb.addEventListener('change', () => { c.on = cb.checked; });
      const t = h('input', { type: 'text', class: 'text', value: c.title, 'aria-label': '連載のタイトル' });
      t.addEventListener('input', () => { c.title = t.value; });
      return h('div', { class: 'note-box' },
        h('label', { class: 'check' }, cb, h('span', null, `${c.g.books.length}本の記事を1冊の連載にする`)),
        h('div', { class: 'field' }, h('span', null, '本のタイトル'), t),
        h('ol', { style: 'margin:4px 0 0;padding-left:1.4em;font-size:13px' }, c.g.books.map((b) => h('li', null, b.title))));
    }),
    shelves.length ? h('h3', null, '棚を作る候補') : null,
    ...shChecks.map((c) => {
      const cb = h('input', { type: 'checkbox' });
      cb.addEventListener('change', () => { c.on = cb.checked; });
      return h('div', { class: 'note-box' },
        h('label', { class: 'check' }, cb, h('span', null, `「${c.name}」の棚を作り、${c.g.books.length}冊を移す`)),
        h('p', { class: 'sub', style: 'margin:0;font-size:12px;color:var(--sub)' }, c.g.books.map((b) => b.title).join(' ／ ')));
    }));
  openModal({
    title: '整理の提案', body, wide: true,
    actions: [
      { label: 'あとで' },
      { label: '選んだ提案を使う', primary: true, onClick: async () => {
        const changed = [];
        for (const c of shChecks.filter((x) => x.on)) {
          const id = uid('sh');
          S.shop.shelves.splice(S.shop.shelves.length - 1, 0, { id, name: c.name, keywords: [] });
          c.g.books.forEach((b, i) => { b.shelfId = id; b.order = i + 1; changed.push(b); });
        }
        for (const c of sChecks.filter((x) => x.on)) {
          const members = c.g.books;
          const first = members[0];
          const book = newBook({
            title: c.title.trim() || first.title, articleIds: members.map((m) => m.articleIds[0]), kind: 'serial',
            shelfId: first.shelfId, order: first.order, seriesStatus: null,
          });
          members.forEach((m) => { m.hidden = true; m.mergedInto = book.id; changed.push(m); });
          changed.push(book);
        }
        try { await saveAll({ shop: true, books: changed }); } catch { /* error shown */ }
        rerender();
      } },
    ],
    onClose: () => onDone && onDone(),
  });
}

// ================= series =================
export function openSeriesEditor({ book = null, preselect = [] } = {}) {
  const editing = !!book;
  const st = {
    title: book ? book.title : '',
    kind: book ? book.kind : 'serial',
    ids: book ? [...book.articleIds] : [...preselect],
    seriesStatus: book ? book.seriesStatus : null,
    mode: book ? book.mode : 'novel',
    writing: book ? book.writing : 'vertical',
  };
  // candidates: articles in single visible books + articles in this series
  const singles = visibleBooks().filter((b) => b.kind === 'single');
  const pool = [...new Set([...st.ids, ...singles.map((b) => b.articleIds[0])])].map((id) => S.articles.get(id)).filter(Boolean)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const title = h('input', { type: 'text', class: 'text', value: st.title, placeholder: '例：旅の途中', 'aria-label': '本のタイトル' });
  title.addEventListener('input', () => { st.title = title.value; });
  const order = h('ol', { class: 'list', 'aria-label': '章の順番' });
  const poolList = h('ul', { class: 'list', style: 'max-height:40vh;overflow:auto' });
  const q = h('input', { type: 'search', class: 'text', placeholder: '記事をさがす', 'aria-label': '記事をさがす' });
  q.addEventListener('input', () => renderPool());

  function renderOrder() {
    order.replaceChildren(...st.ids.map((id, i) => {
      const a = S.articles.get(id);
      return h('li', null,
        h('span', { style: 'min-width:2em;font-family:var(--serif);color:var(--sub)' }, `${i + 1}`),
        h('span', { class: 'grow title' }, a ? a.title || '無題' : '（記事が見つかりません）'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${i + 1}章を前へ`, disabled: i === 0 || null, onclick: () => { move(i, -1); } }, icon('up')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${i + 1}章を後ろへ`, disabled: i === st.ids.length - 1 || null, onclick: () => { move(i, 1); } }, icon('down')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${i + 1}章を外す`, onclick: () => { st.ids.splice(i, 1); renderOrder(); renderPool(); } }, icon('close')));
    }));
    if (!st.ids.length) order.appendChild(h('li', { class: 'hint' }, '下の一覧から記事を選んでください'));
  }
  function move(i, d) { const [x] = st.ids.splice(i, 1); st.ids.splice(i + d, 0, x); renderOrder(); const btns = order.querySelectorAll('li')[i + d]?.querySelectorAll('button'); btns && btns[d < 0 ? 0 : 1]?.focus(); }
  function renderPool() {
    const k = q.value.trim().toLowerCase();
    poolList.replaceChildren(...pool.filter((a) => !k || (a.title || '').toLowerCase().includes(k)).slice(0, 300).map((a) => {
      const cb = h('input', { type: 'checkbox', checked: st.ids.includes(a.id) || null });
      cb.addEventListener('change', () => {
        if (cb.checked) st.ids.push(a.id); else st.ids = st.ids.filter((x) => x !== a.id);
        renderOrder();
      });
      return h('li', null, h('label', { class: 'check', style: 'flex:1' }, cb, h('span', { class: 'grow' }, h('span', { class: 'title' }, a.title || '無題'), h('br'), h('span', { class: 'sub' }, `${formatDate(a.date)}・${STATUS_LABEL[a.status] || a.status}`))));
    }));
  }
  const seg = (label, key, opts) => h('div', { class: 'field' }, h('span', null, label), h('div', { class: 'seg', role: 'group', 'aria-label': label }, ...opts.map(([v, l]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(st[key] === v) }, l);
    b.addEventListener('click', () => { st[key] = v; $$('button', b.parentNode).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
    return b;
  })));
  const body = h('div', null,
    h('div', { class: 'field' }, h('span', null, '本のタイトル（元の記事タイトルとは別に保存されます）'), title),
    seg('種類', 'kind', [['serial', '連載小説・連載'], ['anthology', '短編集']]),
    seg('連載の状態（自分で設定）', 'seriesStatus', [[null, '表示しない'], ['ongoing', '連載中'], ['complete', '完結']]),
    seg('読み方', 'mode', [['novel', '小説として読む'], ['post', '通常']]),
    seg('標準の書字方向', 'writing', [['vertical', '縦書き'], ['horizontal', '横書き']]),
    h('h3', null, '章の順番'), order,
    h('h3', null, '収録する記事'), q, poolList);
  renderOrder(); renderPool();
  openModal({
    title: editing ? '連載・短編集を編集' : '連載・短編集をつくる', body, wide: true,
    actions: [
      { label: 'キャンセル' },
      { label: editing ? '保存' : 'この内容で1冊にまとめる', primary: true, onClick: async () => {
        if (st.ids.length < 2) { toast('2本以上の記事を選んでください'); return false; }
        if (!st.title.trim()) { toast('本のタイトルを入れてください'); title.focus(); return false; }
        await saveSeries(book, st);
        return true;
      } },
    ],
  });
}

async function saveSeries(book, st) {
  const changed = [];
  const target = book ? { ...book } : newBook({ kind: st.kind });
  const prevIds = book ? book.articleIds : [];
  target.title = st.title.trim(); target.kind = st.kind; target.articleIds = [...st.ids];
  target.seriesStatus = st.seriesStatus; target.mode = st.mode; target.writing = st.writing;
  // hide single books of included articles (kept, so un-merging restores their design)
  let firstSingle = null;
  for (const id of st.ids) {
    for (const b of S.books.values()) {
      if (b.id !== target.id && b.kind === 'single' && b.articleIds[0] === id && !b.hidden) {
        if (!firstSingle) firstSingle = b;
        changed.push({ ...b, hidden: true, mergedInto: target.id });
      }
    }
  }
  if (!book && firstSingle) { target.shelfId = firstSingle.shelfId; target.order = firstSingle.order; }
  // articles removed from an existing series → bring their single book back (or create one)
  for (const id of prevIds.filter((x) => !st.ids.includes(x))) {
    const old = [...S.books.values()].find((b) => b.kind === 'single' && b.articleIds[0] === id && b.mergedInto === target.id);
    if (old) changed.push({ ...old, hidden: false, mergedInto: null });
    else { const a = S.articles.get(id); changed.push(newBook({ title: a ? a.title : '無題', articleIds: [id], shelfId: target.shelfId, order: target.order + 0.5 })); }
  }
  changed.push(target);
  // featured: a merged single can't stay featured
  S.shop.featured = S.shop.featured.filter((id) => !changed.some((c) => c.id === id && c.hidden));
  try { await saveAll({ shop: true, books: changed }); } catch { return; }
  view.selected = target.id;
  rerender();
  toast(book ? '保存しました' : `「${target.title}」にまとめました`);
}

export async function dissolveSeries(b) {
  const ok = await confirmDialog(`「${b.title}」のまとめを解除して、記事ごとの本に戻しますか？\n元の本の装丁やPOPはそのまま戻ります。この連載の装丁は削除されます。`, { ok: '解除する' });
  if (!ok) return;
  const changed = [];
  for (const id of b.articleIds) {
    const old = [...S.books.values()].find((x) => x.kind === 'single' && x.articleIds[0] === id && x.mergedInto === b.id);
    if (old) changed.push({ ...old, hidden: false, mergedInto: null, shelfId: b.shelfId });
    else { const a = S.articles.get(id); changed.push(newBook({ title: a ? a.title : '無題', articleIds: [id], shelfId: b.shelfId, order: b.order })); }
  }
  S.shop.featured = S.shop.featured.filter((x) => x !== b.id);
  view.selected = null;
  try { await saveAll({ shop: true, books: changed, delBooks: [b.id] }); } catch { return; }
  rerender();
  toast('個別の本に戻しました');
}

// ================= book manager =================
export function openBookManager(ctx) {
  const list = h('ul', { class: 'list' });
  const q = h('input', { type: 'search', class: 'text', placeholder: '本をさがす', 'aria-label': '本をさがす' });
  const loose = () => {
    const used = new Set();
    for (const b of S.books.values()) for (const id of b.articleIds) used.add(id);
    return [...S.articles.values()].filter((a) => !used.has(a.id));
  };
  function draw() {
    const k = q.value.trim().toLowerCase();
    const books = visibleBooks().filter((b) => !k || b.title.toLowerCase().includes(k)).sort((a, b) => (a.kind === 'single') - (b.kind === 'single') || byOrder(a, b));
    list.replaceChildren(...books.slice(0, 500).map((b) => {
      const st = bookStatus(b);
      return h('li', null,
        h('span', { class: 'grow' }, h('span', { class: 'title' }, b.title), h('br'),
          h('span', { class: 'sub' }, [b.kind !== 'single' ? `${b.kind === 'serial' ? '連載' : '短編集'}・${b.articleIds.length}話` : '1記事', STATUS_LABEL[st], b.shareBody ? '本文共有ON' : ''].filter(Boolean).join('・'))),
        btn('装丁', () => { m.close(); openDesignEditor(b, ctx); }, { cls: 'small' }),
        b.kind !== 'single' ? btn('章', () => { m.close(); openSeriesEditor({ book: b }); }, { cls: 'small' }) : null);
    }));
    const lo = loose();
    if (lo.length) {
      list.appendChild(h('li', null, h('strong', null, `本になっていない記事（${lo.length}件）`)));
      for (const a of lo.slice(0, 300)) {
        list.appendChild(h('li', null, h('span', { class: 'grow' }, h('span', { class: 'title' }, a.title || '無題'), h('br'), h('span', { class: 'sub' }, STATUS_LABEL[a.status] || a.status)),
          btn('本にする', async () => {
            const nb = newBook({ title: a.title || '無題', articleIds: [a.id], order: Date.now() });
            await saveBooks([nb]).catch(() => {});
            rerender(); draw();
          }, { cls: 'small' })));
      }
    }
  }
  q.addEventListener('input', draw);
  const m = openModal({
    title: '本と連載', wide: true,
    body: h('div', null,
      h('div', { class: 'row', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px' },
        btn('連載・短編集をつくる', () => { m.close(); openSeriesEditor({}); }, { cls: 'primary', iconName: 'layers' }),
        btn('整理の提案を見る', () => { m.close(); openOrganizeSuggestions({}); }, {})),
      q, list),
    actions: [{ label: '閉じる' }],
  });
  draw();
}

// ================= shelves =================
export function openShelfManager(ctx) {
  const draft = S.shop.shelves.map((s) => ({ ...s, keywords: [...(s.keywords || [])] }));
  const list = h('ol', { class: 'list' });
  function draw() {
    list.replaceChildren(...draft.map((s, i) => {
      const isUns = s.id === UNSORTED;
      const name = h('input', { type: 'text', class: 'text', value: s.name, 'aria-label': '棚の名前', maxlength: '24' });
      name.addEventListener('input', () => { s.name = name.value; });
      const kw = h('input', { type: 'text', class: 'text', value: (s.keywords || []).join('、'), placeholder: 'キーワード（、区切り）', 'aria-label': `${s.name}のキーワード`, disabled: isUns || null });
      kw.addEventListener('input', () => { s.keywords = kw.value.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20); });
      const n = booksOnShelf(s.id).length;
      return h('li', { style: 'flex-wrap:wrap' },
        h('div', { class: 'grow', style: 'display:grid;gap:6px;min-width:200px' }, name, isUns ? h('span', { class: 'sub' }, '「未分類」は削除できません（どの棚にもない本が入ります）') : kw, h('span', { class: 'sub' }, `${n}冊`)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${s.name}を上へ`, disabled: i === 0 || isUns || null, onclick: () => { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; draw(); } }, icon('up')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${s.name}を下へ`, disabled: i >= draft.length - 2 || isUns || null, onclick: () => { [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]]; draw(); } }, icon('down')),
        isUns ? null : h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${s.name}を削除`, onclick: async () => {
          if (n && !(await confirmDialog(`「${s.name}」を削除しますか？\n${n}冊の本は「未分類」に移ります。`, { ok: '削除', danger: true }))) return;
          draft.splice(i, 1); draw();
        } }, icon('trash')));
    }));
  }
  const add = h('input', { type: 'text', class: 'text', placeholder: '新しい棚の名前', 'aria-label': '新しい棚の名前', maxlength: '24' });
  const addBtn = btn('棚を追加', () => {
    const v = add.value.trim();
    if (!v) return;
    draft.splice(draft.length - 1, 0, { id: uid('sh'), name: v, keywords: [] });
    add.value = ''; draw();
  }, { iconName: 'plus' });
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
  draw();
  const apply = async (assign) => {
    // keep UNSORTED last
    const uns = draft.find((s) => s.id === UNSORTED);
    S.shop.shelves = [...draft.filter((s) => s.id !== UNSORTED && s.name.trim()), uns].map((s) => ({ ...s, name: s.name.trim() || '名前なし' }));
    const changed = [];
    for (const b of S.books.values()) if (!shelfExists(b.shelfId)) { b.shelfId = UNSORTED; changed.push(b); }
    if (assign) {
      let moved = 0;
      for (const b of booksOnShelf(UNSORTED)) {
        const titles = [b.title, ...bookArticles(b).map((a) => a.title)].join(' ');
        const hit = S.shop.shelves.find((s) => s.id !== UNSORTED && (s.keywords || []).length && matchKeywords(titles, s.keywords));
        if (hit) { b.shelfId = hit.id; b.order = Date.now() + moved++; changed.push(b); }
      }
      toast(moved ? `${moved}冊をキーワードで振り分けました（未分類の本だけが対象です）` : 'キーワードに当てはまる未分類の本はありませんでした');
    }
    try { await saveAll({ shop: true, books: changed }); } catch { /* shown */ }
    rerender();
  };
  openModal({
    title: '棚の管理',
    body: h('div', null,
      h('p', { class: 'hint' }, '棚の名前と順番を変えられます。キーワードを設定すると、「未分類」の本を自動で振り分ける補助ができます（手動で置いた本は動かしません）。'),
      list, h('div', { style: 'display:flex;gap:8px;margin-top:12px' }, add, addBtn)),
    actions: [
      { label: 'キャンセル' },
      { label: '保存してキーワードで振り分け', onClick: () => apply(true) },
      { label: '保存', primary: true, onClick: () => apply(false) },
    ],
  });
}

// ================= theme =================
export function openThemePicker(ctx = {}) {
  let chosen = S.shop.theme;
  const grid = h('div', { class: 'theme-grid', role: 'group', 'aria-label': 'テーマ' });
  const sampleBooks = visibleBooks().slice(0, 9);
  function draw() {
    grid.replaceChildren(...THEMES.map((t) => {
      const card = h('button', { type: 'button', class: 'theme-card', 'aria-pressed': String(chosen === t.id), 'aria-label': `${t.name}：${t.blurb}` });
      const bay = h('div', { class: 'tc-bay', style: `background-image:url("${t.thumb}")` });
      const row = h('div', { class: 'bay-row', style: 'bottom:' + ((1 - (t.baseline - 0.2) / 0.8) * 100) + '%;left:8%;right:8%' });
      const fake = sampleBooks.length ? sampleBooks : [0, 1, 2, 3, 4, 5].map((i) => newBook({ id: 'demo' + i, title: ['小さな工夫', '雨の日の記録', '旅の途中', '好きなもの', 'はじめてのアプリ', '日々のこと'][i] }));
      fake.slice(0, 7).forEach((b, i) => row.appendChild(renderSpine(b, t, { w: 20, h: 70 + (i * 37 % 20) })));
      $$('.book', row).forEach((el) => { el.setAttribute('tabindex', '-1'); el.setAttribute('aria-hidden', 'true'); el.style.pointerEvents = 'none'; $$('.sp-title', el).forEach((x) => { x.style.fontSize = '9px'; }); });
      bay.appendChild(row);
      card.append(bay, h('span', { class: 'tc-name' }, h('span', null, t.name, h('br'), h('small', null, t.blurb)), chosen === t.id ? h('span', { class: 'check-mark', 'aria-hidden': 'true' }, '✓') : null));
      card.addEventListener('click', () => { chosen = t.id; draw(); grid.querySelector('[aria-pressed="true"]')?.focus(); });
      return card;
    }));
  }
  draw();
  const body = h('div', null,
    ctx.firstTime ? h('p', null, '本棚の雰囲気を選んでください。あとからいつでも変えられます。') : null,
    grid,
    h('p', { class: 'hint' }, 'テーマを変えても、登録した画像や1冊ごとの装丁設定は消えません。'));
  openModal({
    title: 'あなたの本屋は、どんな場所？', body, wide: true,
    actions: [
      ...(ctx.firstTime ? [] : [{ label: '全冊の色・素材をテーマ標準に戻す…', onClick: async () => { await resetAllDesigns(); return false; } }]),
      { label: ctx.firstTime ? 'この雰囲気ではじめる' : 'このテーマにする', primary: true, onClick: async () => {
        S.shop.theme = chosen;
        await saveShop().catch(() => {});
        if (ctx.rerender) ctx.rerender();
      } },
    ],
    onClose: () => ctx.onDone && ctx.onDone(),
  });
}

async function resetAllDesigns() {
  const ok = await confirmDialog('すべての本の「色・素材・背表紙の形・挿絵・文字色」をテーマ標準に戻しますか？\n表紙・背表紙の画像、タイトル、POPはそのまま残ります。', { ok: '標準に戻す', danger: true });
  if (!ok) return;
  const list = [...S.books.values()].map((b) => ({ ...b, design: { ...b.design, color: null, material: null, spineStyle: null, motif: null, titleColor: null } }));
  try { await saveBooks(list); toast('テーマ標準に戻しました'); } catch { /* */ }
  rerender();
}

// ================= shop settings =================
export function openShopSettings(ctx) {
  const s = S.shop;
  const f = (label, el, hint) => h('div', { class: 'field' }, h('label', null, label, el), hint ? h('p', { class: 'hint' }, hint) : null);
  const name = h('input', { type: 'text', value: s.name, maxlength: '40' });
  const tagline = h('input', { type: 'text', value: s.tagline, maxlength: '60' });
  const owner = h('input', { type: 'text', value: s.owner, maxlength: '40' });
  const intro = h('textarea', { maxlength: '600' }); intro.value = s.intro || '';
  const profile = h('input', { type: 'url', value: s.profileUrl || '', placeholder: 'https://note.com/…', inputmode: 'url' });
  const featPop = h('input', { type: 'text', value: s.featuredPop || '', maxlength: '30' });
  let avatarId = s.avatarImageId;
  let pendingAvatar = null;
  const avatarBox = h('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' });
  const drawAvatar = () => {
    const url = pendingAvatar ? URL.createObjectURL(pendingAvatar.blob) : avatarId && imageUrl(avatarId);
    avatarBox.replaceChildren(
      url ? h('img', { src: url, alt: 'プロフィール画像', style: 'width:64px;height:64px;border-radius:50%;object-fit:cover' }) : h('span', { class: 'hint' }, '未設定'),
      fileButton('画像を選ぶ', async (file) => { try { pendingAvatar = await intakeFile(file, { maxSide: 400 }); drawAvatar(); } catch (e) { toast(e.message, 'error'); } }),
      (url ? btn('外す', () => { avatarId = null; pendingAvatar = null; drawAvatar(); }, { cls: 'small' }) : null));
  };
  drawAvatar();
  const info = h('p', { class: 'hint' }, '保存容量を確認しています…');
  storageInfo().then((i) => {
    info.textContent = i.usage != null ? `この本屋の保存量：約${Math.round(i.usage / 1048576)}MB${i.quota ? `（目安の上限 約${Math.round(i.quota / 1048576)}MB）` : ''}${i.persisted ? '・削除されにくい保存が有効' : ''}` : '保存量を取得できませんでした';
  });
  const body = h('div', null,
    f('店名', name), f('ひとこと（店名の横に表示）', tagline), f('店主名', owner),
    f('自己紹介', intro, '「店主」ボタンや右側のパネルに表示されます。'),
    h('div', { class: 'field' }, h('span', null, 'プロフィール画像（任意）'), avatarBox),
    f('noteプロフィールURL（任意）', profile, 'https://note.com/ から始まるURLのみ。共有リンクにも含まれます。'),
    f('おすすめ棚のPOP', featPop, '「初めての方へ」の棚に立てる札の文字です。空にすると札を出しません。'),
    h('h3', null, 'データの保存とバックアップ'),
    h('p', { class: 'hint' }, 'データはこの端末のブラウザの中だけに保存されています。Safariの「履歴とWebサイトデータを消去」などで消えることがあるため、ときどきバックアップを書き出してください。'),
    info,
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      btn('バックアップを書き出す', () => exportBackup(), { iconName: 'download' }),
      btn('バックアップから復元', () => openRestore(ctx.afterImport), { iconName: 'upload' }),
      btn('すべて削除', async () => {
        const ok = await confirmDialog('この端末の本屋のデータ（記事・本・画像・設定）をすべて削除します。元に戻せません。\n先にバックアップを書き出すことをおすすめします。', { ok: 'すべて削除', danger: true });
        if (!ok) return;
        const { wipeAll } = await import('./state.js');
        await wipeAll();
        m.close();
        ctx.goWelcome();
      }, { cls: 'danger' })));
  const m = openModal({
    title: 'お店の設定', body,
    actions: [{ label: 'キャンセル' }, { label: '保存', primary: true, onClick: async () => {
      const url = profile.value.trim();
      if (url && !isNoteUrl(url)) { toast('プロフィールURLは https://note.com/ のURLを入れてください', 'error'); profile.focus(); return false; }
      s.name = name.value.trim() || 'わたしの小さな本屋'; s.tagline = tagline.value.trim(); s.owner = owner.value.trim();
      s.intro = intro.value.trim(); s.profileUrl = url ? safeHttpUrl(url) : ''; s.featuredPop = featPop.value.trim();
      const images = [];
      if (pendingAvatar) { images.push(pendingAvatar); avatarId = pendingAvatar.id; }
      s.avatarImageId = avatarId;
      const refs = referencedImageIds();
      const orphans = [...S.images.values()].filter((i) => i.origin === 'upload' && !refs.has(i.id) && !images.includes(i)).map((i) => i.id);
      try { await saveAll({ shop: true, images, delImages: orphans }); } catch { return false; }
      document.title = s.name;
      rerender();
    } }],
  });
}

function fileButton(label, onFile, accept = 'image/png,image/jpeg,image/gif,image/webp') {
  const input = h('input', { type: 'file', accept, class: 'visually-hidden', tabindex: '-1' });
  input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; if (f) onFile(f); });
  const b = btn(label, () => input.click(), { cls: 'small', iconName: 'image' });
  return h('span', null, b, input);
}

export function openRestoreFromWelcome(onDone) { openRestore(onDone); }

// ================= design editor =================
export function openDesignEditor(book, ctx) {
  const theme = getTheme(S.shop.theme);
  const d = structuredClone({ ...book, design: { ...book.design } });
  if (d.design.coverPos == null) d.design.coverPos = { x: 50, y: 50, s: 1 };
  if (d.design.spinePos == null) d.design.spinePos = { x: 50, y: 50, s: 1 };
  const pending = new Map(); // uploaded but unsaved images
  const preview = h('div', { class: 'design-preview', 'aria-label': '装丁のプレビュー' });
  const drawPreview = () => {
    preview.replaceChildren(
      renderSpine(d, theme, { w: 50, h: 240 }),
      renderCover(d, theme, { w: 170, h: 243, static: true }));
    $$('.book', preview).forEach((el) => { el.setAttribute('tabindex', '-1'); el.setAttribute('aria-hidden', 'true'); });
  };
  const tabsDef = [['cover', '表紙'], ['spine', '背表紙'], ['text', '文字'], ['color', '色と素材'], ['pop', 'POP・紹介'], ['read', '読み方・公開']];
  let tab = 'cover';
  const panel = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, ...tabsDef.map(([k, l]) => {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab) }, l);
    b.addEventListener('click', () => { tab = k; $$('[role=tab]', tabs).forEach((x) => x.setAttribute('aria-selected', String(x === b))); drawPanel(); });
    return b;
  }));
  const update = () => { drawPreview(); };

  const articleImages = () => {
    const ids = [];
    for (const a of bookArticles(d)) {
      if (a.headImageId) ids.push(a.headImageId);
      for (const im of a.images || []) { if (im.imageId) ids.push(im.imageId); for (const c of im.candidates || []) ids.push(c); }
    }
    return [...new Set(ids)].filter((id) => S.images.has(id));
  };
  const addUpload = async (file) => {
    try {
      const rec = await intakeFile(file);
      pending.set(rec.id, rec);
      S.images.set(rec.id, rec); // temporary (removed on cancel)
      return rec.id;
    } catch (e) { toast(e instanceof ImageRejected ? e.message : '画像を読み込めませんでした', 'error'); return null; }
  };
  const seg = (label, get, set, opts) => h('div', { class: 'field' }, h('span', null, label), h('div', { class: 'seg', role: 'group', 'aria-label': label }, ...opts.map(([v, l]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(get() === v) }, l);
    b.addEventListener('click', () => { set(v); $$('button', b.parentNode).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); update(); if (opts.rerender) drawPanel(); });
    return b;
  })));
  const check = (label, get, set) => { const cb = h('input', { type: 'checkbox', checked: get() || null }); cb.addEventListener('change', () => { set(cb.checked); update(); }); return h('label', { class: 'check' }, cb, h('span', null, label)); };
  const range = (label, min, max, step, get, set, fmt = (v) => v) => {
    const out = h('span', null, fmt(get()));
    const r = h('input', { type: 'range', min, max, step, value: get(), 'aria-label': label });
    r.addEventListener('input', () => { set(parseFloat(r.value)); out.textContent = fmt(parseFloat(r.value)); update(); syncCrop(); });
    return h('label', { class: 'range' }, h('span', null, label), r, out);
  };
  let syncCrop = () => {};

  function cropper(imgId, pos, aspect, width) {
    const url = imageUrl(imgId);
    const frame = h('div', { class: 'crop-frame', role: 'img', 'aria-label': '画像の位置調整（ドラッグ、または下のスライダー）' });
    frame.style.width = width + 'px'; frame.style.height = width / aspect + 'px';
    const img = h('img', { src: url, alt: '' });
    frame.appendChild(img);
    const apply = () => {
      img.style.objectPosition = `${pos.x}% ${pos.y}%`;
      img.style.transformOrigin = `${pos.x}% ${pos.y}%`;
      img.style.transform = `scale(${pos.s})`;
    };
    apply();
    syncCrop = apply;
    let start = null;
    frame.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; frame.setPointerCapture(e.pointerId); });
    frame.addEventListener('pointermove', (e) => {
      if (!start) return;
      pos.x = clamp(start.px - (e.clientX - start.x) / frame.clientWidth * 100 / pos.s * 1.6, 0, 100);
      pos.y = clamp(start.py - (e.clientY - start.y) / frame.clientHeight * 100 / pos.s * 1.6, 0, 100);
      apply(); update();
    });
    const end = () => { start = null; drawPanelRanges(); };
    frame.addEventListener('pointerup', end); frame.addEventListener('pointercancel', end);
    return frame;
  }
  let drawPanelRanges = () => {};

  function imagePicker(current, onPick, { allowAuto, autoLabel }) {
    const ids = articleImages();
    const grid = h('div', { class: 'img-pick', role: 'group', 'aria-label': '画像を選ぶ' });
    const opt = (key, label, url) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(current === key), 'aria-label': label });
      if (url) b.appendChild(h('img', { src: url, alt: '' }));
      b.appendChild(h('span', { class: 'lbl' }, label));
      b.addEventListener('click', () => onPick(key));
      return b;
    };
    if (allowAuto) grid.appendChild(opt(undefined, autoLabel, (() => { const a = bookArticles(d)[0]; return a && a.headImageId ? imageUrl(a.headImageId) : null; })()));
    grid.appendChild(opt(null, '画像なし（文字）', null));
    for (const id of ids) grid.appendChild(opt(id, '本文の画像', imageUrl(id)));
    for (const id of pending.keys()) if (!ids.includes(id)) grid.appendChild(opt(id, 'アップロード', imageUrl(id)));
    if (current && !ids.includes(current) && !pending.has(current) && S.images.has(current)) grid.appendChild(opt(current, '登録済みの画像', imageUrl(current)));
    return grid;
  }

  function drawPanel() {
    const D = d.design;
    const els = [];
    if (tab === 'cover') {
      const cur = D.coverImageId;
      els.push(h('p', { class: 'hint' }, '標準は、取り込めた見出し画像（連載は第1章の画像）です。画像は伸ばさずに切り抜いて使います。'));
      els.push(imagePicker(cur, (k) => { D.coverImageId = k; update(); drawPanel(); }, { allowAuto: true, autoLabel: '見出し画像（自動）' }));
      els.push(h('div', { style: 'margin:10px 0' }, fileButton('画像をアップロード', async (f) => { const id = await addUpload(f); if (id) { D.coverImageId = id; D.coverPos = { x: 50, y: 50, s: 1 }; update(); drawPanel(); } })));
      const imgId = coverImageId(d);
      if (imgId) {
        els.push(seg('画像の置き方', () => D.coverLayout || null, (v) => { D.coverLayout = v; drawPanel(); }, [[null, '自動'], ['full', '全面'], ['plate', '貼り込み']]));
        const lay = coverLayout(d);
        els.push(cropper(imgId, D.coverPos, lay === 'plate' ? 1.42 : 0.7, lay === 'plate' ? 240 : 170));
        const ranges = h('div');
        drawPanelRanges = () => ranges.replaceChildren(
          range('横位置', 0, 100, 1, () => Math.round(D.coverPos.x), (v) => { D.coverPos.x = v; }, (v) => v + '%'),
          range('縦位置', 0, 100, 1, () => Math.round(D.coverPos.y), (v) => { D.coverPos.y = v; }, (v) => v + '%'),
          range('拡大', 1, 3, 0.05, () => D.coverPos.s, (v) => { D.coverPos.s = v; }, (v) => v.toFixed(2) + '倍'));
        drawPanelRanges();
        els.push(ranges);
        els.push(check('表紙に題名を重ねる（画像に文字が入っている場合はオフ）', () => D.showTitle !== false, (v) => { D.showTitle = v; }));
      } else {
        els.push(h('div', { class: 'field' }, h('label', null, '挿絵', (() => {
          const sel = h('select', { class: 'text' }, h('option', { value: '' }, '自動'), ...[...MOTIFS, 'none'].map((m) => h('option', { value: m, selected: D.motif === m || null }, MOTIF_NAMES[m])));
          sel.addEventListener('change', () => { D.motif = sel.value || null; update(); });
          return sel;
        })())));
      }
    } else if (tab === 'spine') {
      els.push(h('p', { class: 'hint' }, '背表紙には表紙とは別の画像を設定できます。細長く切り抜かれます。'));
      els.push(imagePicker(D.spineImageId, (k) => { D.spineImageId = k === undefined ? null : k; update(); drawPanel(); }, { allowAuto: false }));
      els.push(h('div', { style: 'margin:10px 0' }, fileButton('画像をアップロード', async (f) => { const id = await addUpload(f); if (id) { D.spineImageId = id; D.spinePos = { x: 50, y: 50, s: 1 }; update(); drawPanel(); } })));
      if (D.spineImageId && S.images.has(D.spineImageId)) {
        els.push(cropper(D.spineImageId, D.spinePos, 0.2, 60));
        const ranges = h('div');
        drawPanelRanges = () => ranges.replaceChildren(
          range('横位置', 0, 100, 1, () => Math.round(D.spinePos.x), (v) => { D.spinePos.x = v; }, (v) => v + '%'),
          range('縦位置', 0, 100, 1, () => Math.round(D.spinePos.y), (v) => { D.spinePos.y = v; }, (v) => v + '%'),
          range('拡大', 1, 3, 0.05, () => D.spinePos.s, (v) => { D.spinePos.s = v; }, (v) => v.toFixed(2) + '倍'));
        drawPanelRanges();
        els.push(ranges);
        els.push(check('背表紙に題名を重ねる', () => D.showTitle !== false, (v) => { D.showTitle = v; }));
      }
      const st = h('input', { type: 'text', class: 'text', value: d.spineTitle || '', placeholder: `自動：${autoSpineTitle(d.title)}`, maxlength: '60' });
      st.addEventListener('input', () => { d.spineTitle = st.value.trim() || null; update(); });
      els.push(h('div', { class: 'field' }, h('label', null, '背表紙の題名（空欄なら自動で短くします）', st)));
      const styleSel = h('select', { class: 'text' }, h('option', { value: '' }, '自動（テーマに合わせる）'), ...Object.entries(SPINE_STYLE_NAMES).map(([k, v]) => h('option', { value: k, selected: D.spineStyle === k || null }, v)));
      styleSel.addEventListener('change', () => { D.spineStyle = styleSel.value || null; update(); });
      els.push(h('div', { class: 'field' }, h('label', null, '背表紙の形', styleSel)));
    } else if (tab === 'text') {
      const t = h('input', { type: 'text', class: 'text', value: d.title, maxlength: '120' });
      t.addEventListener('input', () => { d.title = t.value; update(); });
      const orig = bookArticles(d).map((a) => a.title).filter(Boolean);
      els.push(h('div', { class: 'field' }, h('label', null, '本のタイトル', t), orig.length ? h('p', { class: 'hint' }, `元の記事タイトル：${orig.slice(0, 3).join(' ／ ')}${orig.length > 3 ? ' …' : ''}（元の記事は変更されません）`) : null));
      els.push(check('表紙に著者名（店主名）を出す', () => D.showAuthor !== false, (v) => { D.showAuthor = v; }));
      els.push(check('表紙に題名を出す', () => D.showTitle !== false, (v) => { D.showTitle = v; }));
      els.push(seg('題名の位置', () => D.titleAlign || 'top', (v) => { D.titleAlign = v; }, [['top', '上'], ['center', '中央'], ['bottom', '下']]));
      els.push(seg('表紙の題名の向き', () => D.titleWriting || 'horizontal', (v) => { D.titleWriting = v; }, [['horizontal', '横書き'], ['vertical', '縦書き']]));
      els.push(colorField('文字色', () => D.titleColor, (v) => { D.titleColor = v; update(); }, ['#3a2f25', '#f6ecd3', '#ffffff', '#d8b86e', '#1d2c3a', '#7fdce8']));
    } else if (tab === 'color') {
      els.push(colorField('本の色', () => D.color, (v) => { D.color = v; update(); }, theme.books));
      els.push(seg('素材', () => D.material || null, (v) => { D.material = v; }, [[null, '自動'], ...MATERIALS.map((m) => [m.id, m.name])]));
      els.push(h('p', { class: 'hint' }, '色・高さ・厚みは本ごとに固定され、表示のたびに変わりません。厚みは演出で、実際の文字量とは関係ありません。'));
      els.push(btn('この本をテーマ標準に戻す', () => { Object.assign(D, { color: null, material: null, spineStyle: null, motif: null, titleColor: null }); update(); drawPanel(); }, { cls: 'small' }));
    } else if (tab === 'pop') {
      const pop = h('textarea', { maxlength: '120', placeholder: '例：この記事から、全部始まりました。' }); pop.value = d.pop || '';
      pop.addEventListener('input', () => { d.pop = pop.value; update(); });
      const blurb = h('textarea', { maxlength: '400', placeholder: '本の紹介（任意）' }); blurb.value = d.blurb || '';
      blurb.addEventListener('input', () => { d.blurb = blurb.value; });
      els.push(h('div', { class: 'field' }, h('label', null, '店主のPOP（120字まで）', pop), h('p', { class: 'hint' }, '未入力ならPOPは出しません。40字以内なら棚にも小さく立てられます。')));
      els.push(check('棚にもPOPを立てる（40字以内のとき）', () => d.popOnShelf !== false, (v) => { d.popOnShelf = v; }));
      els.push(h('div', { class: 'field' }, h('label', null, '紹介文', blurb)));
    } else if (tab === 'read') {
      els.push(seg('表示モード', () => d.mode, (v) => { d.mode = v; }, [['post', '通常（記事）'], ['novel', '小説']]));
      els.push(seg('標準の書字方向', () => d.writing, (v) => { d.writing = v; }, [['horizontal', '横書き'], ['vertical', '縦書き']]));
      if (d.kind !== 'single') els.push(seg('連載の状態', () => d.seriesStatus || null, (v) => { d.seriesStatus = v; }, [[null, '表示しない'], ['ongoing', '連載中'], ['complete', '完結']]));
      const st = bookStatus(d);
      els.push(h('h3', null, '本文の公開'));
      els.push(h('p', { class: 'hint' }, `状態：${STATUS_LABEL[st] || st}。本文を共有するのは「画像込みの公開用ZIP」だけです。紹介リンクには本文は入りません。`));
      const canShare = st === 'publish';
      const cb = h('input', { type: 'checkbox', checked: d.shareBody || null, disabled: !canShare || null });
      cb.addEventListener('change', () => { d.shareBody = cb.checked; });
      els.push(h('label', { class: 'check' }, cb, h('span', null, 'この本の本文を、公開用ZIPで読めるようにする')));
      els.push(h('p', { class: 'note-box warn' }, canShare
        ? 'noteの書き出しには有料部分の境界や価格が含まれません。有料記事の場合、有料部分まで公開されてしまいます。公開してよい本文か、ご自身で確認してください。'
        : '下書き・予約・状態が分からない記事を含む本は、本文を公開できません。'));
    }
    panel.replaceChildren(...els);
  }

  function colorField(label, get, set, swatches) {
    const wrap = h('div', { class: 'field' }, h('span', null, label));
    const row = h('div', { class: 'swatches', role: 'group', 'aria-label': label });
    const draw = () => {
      row.replaceChildren(
        (() => { const b = h('button', { type: 'button', class: 'swatch', 'aria-pressed': String(!get()), 'aria-label': '自動', style: 'background:repeating-linear-gradient(45deg,#ddd 0 4px,#fff 4px 8px)' }); b.addEventListener('click', () => { set(null); draw(); }); return b; })(),
        ...swatches.map((c) => { const b = h('button', { type: 'button', class: 'swatch', 'aria-pressed': String(get() === c), 'aria-label': c, style: `background:${c}` }); b.addEventListener('click', () => { set(c); draw(); }); return b; }),
        (() => { const inp = h('input', { type: 'color', value: get() || '#888888', 'aria-label': `${label}を自由に選ぶ`, style: 'width:44px;height:36px;border:0;background:none;padding:0' }); inp.addEventListener('input', () => set(inp.value)); inp.addEventListener('change', draw); return inp; })());
    };
    draw();
    wrap.appendChild(row);
    return wrap;
  }

  drawPreview(); drawPanel();
  const body = h('div', { class: 'design-grid' }, preview, h('div', null, tabs, panel));
  let saved = false;
  openModal({
    title: '装丁・POPの編集', body, wide: true,
    actions: [
      { label: 'キャンセル' },
      { label: '保存', primary: true, onClick: async () => {
        d.title = (d.title || '').trim() || '無題';
        if (d.shareBody && bookStatus(d) !== 'publish') d.shareBody = false;
        const used = new Set([d.design.coverImageId, d.design.spineImageId]);
        const images = [...pending.values()].filter((r) => used.has(r.id));
        // unused uploads from this session are discarded
        for (const id of pending.keys()) if (!used.has(id)) S.images.delete(id);
        const refsBefore = new Set([book.design.coverImageId, book.design.spineImageId].filter(Boolean));
        S.books.set(d.id, d);
        const refs = referencedImageIds();
        const orphans = [...refsBefore].filter((id) => !refs.has(id) && S.images.get(id)?.origin === 'upload');
        try { await saveAll({ shop: false, books: [d], images, delImages: orphans }); saved = true; }
        catch { return false; }
        rerender();
        toast('装丁を保存しました');
      } },
    ],
    onClose: () => { if (!saved) for (const id of pending.keys()) S.images.delete(id); },
  });
}
