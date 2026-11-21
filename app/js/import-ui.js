// Import flow UI: progress → review (select / duplicates / updates) → apply → organize suggestions.
import { h, toast, formatDate, $$ } from './util.js';
import { openModal, progressDialog, alertDialog, icon } from './ui.js';
import { parseExport, ImportError } from './importer.js';
import { S, loadLocal, defaultShop, newBook, saveAll, referencedImageIds, UNSORTED, STATUS_LABEL } from './state.js';
import { excerpt } from './sanitize.js';
import { openOrganizeSuggestions, openThemePicker } from './editor.js';
import { isNoteUrl } from './util.js';

export async function startImport(file, { onDone } = {}) {
  // importing from the welcome / sample screen: switch to the owner's local data first
  if (S.mode !== 'local' || !S.shop) {
    try { await loadLocal(); }
    catch (e) { await alertDialog(`端末保存を使えないため、読み込んだ本屋を保存できません。\n${e.message || ''}`, '保存できません'); return; }
  }
  const fresh = !S.shop;
  const pd = progressDialog('記事を読み込んでいます');
  let plan;
  try {
    plan = await parseExport(file, { progress: (f, m) => pd.set(f, m), cancelled: () => pd.cancelled });
  } catch (e) {
    pd.close();
    if (pd.cancelled) { toast('読み込みをキャンセルしました'); return; }
    console.error(e);
    await alertDialog(e instanceof ImportError || e.name === 'ZipError' ? e.message : `読み込みに失敗しました。\n${e.message || e}`, '読み込めませんでした');
    return;
  }
  pd.close();
  if (!plan.articles.length) { await alertDialog('記事が見つかりませんでした。', '読み込み結果'); return; }
  reviewImport(plan, { fresh, onDone });
}

function classify(plan) {
  const byUrl = new Map();
  for (const a of S.articles.values()) if (a.url) byUrl.set(a.url, a);
  const booked = new Set();
  for (const b of S.books.values()) for (const id of b.articleIds) booked.add(id);
  return plan.articles.map((a) => {
    const existing = S.articles.get(a.id) || (a.url && byUrl.get(a.url)) || null;
    let state = 'new';
    if (existing) state = existing.contentHash === a.contentHash ? (booked.has(existing.id) ? 'same' : 'nobook') : 'updated';
    const selected = state === 'new' ? a.status === 'publish' : state === 'updated' ? true : false;
    return { a, existing, state, selected };
  });
}

function reviewImport(plan, { fresh, onDone }) {
  const rows = classify(plan);
  let filter = 'all';
  const counts = {
    all: rows.length,
    new: rows.filter((r) => r.state === 'new').length,
    updated: rows.filter((r) => r.state === 'updated').length,
    same: rows.filter((r) => r.state === 'same' || r.state === 'nobook').length,
    attention: rows.filter((r) => r.a.status !== 'publish').length,
  };
  const listEl = h('ul', { class: 'list', 'aria-label': '読み込んだ記事' });
  const countEl = h('strong');
  const urlFor = (id) => {
    const rec = plan.images.get(id);
    if (!rec) return null;
    if (!rec._url) rec._url = URL.createObjectURL(rec.blob);
    return rec._url;
  };

  function renderList() {
    const vis = rows.filter((r) => filter === 'all' || (filter === 'new' && r.state === 'new') || (filter === 'updated' && r.state === 'updated')
      || (filter === 'same' && (r.state === 'same' || r.state === 'nobook')) || (filter === 'attention' && r.a.status !== 'publish'));
    listEl.replaceChildren(...vis.slice(0, 400).map((r) => {
      const a = r.a;
      const disabled = r.state === 'same';
      const cb = h('input', { type: 'checkbox', checked: r.selected || null, disabled: disabled || null, 'aria-label': `${a.title || '無題'}を本にする` });
      cb.addEventListener('change', () => { r.selected = cb.checked; updateCount(); });
      const thumb = a.headImageId && urlFor(a.headImageId)
        ? h('img', { src: urlFor(a.headImageId), alt: '', style: 'width:64px;height:40px;object-fit:cover;border-radius:4px;flex:none' })
        : h('span', { style: 'width:64px;height:40px;border-radius:4px;flex:none;background:var(--chip);display:grid;place-items:center;font-size:11px;color:var(--sub)' }, '文字表紙');
      const chips = [];
      const st = a.status;
      chips.push(h('span', { class: `chip ${st === 'publish' ? 'ok' : 'warn'}` }, STATUS_LABEL[st] || '要確認'));
      if (r.state === 'updated') chips.push(h('span', { class: 'chip warn' }, '更新あり（装丁・POP・棚・連載の順番は保持）'));
      if (r.state === 'same') chips.push(h('span', { class: 'chip' }, '取り込み済み・変更なし'));
      if (r.state === 'nobook') chips.push(h('span', { class: 'chip' }, '取り込み済み（本がありません）'));
      if (!a.url && st === 'publish') chips.push(h('span', { class: 'chip warn' }, 'URL不明'));
      const lbl = h('label', { class: 'check', style: 'flex:1;min-width:0;align-items:center' }, cb, thumb,
        h('span', { class: 'grow' },
          h('span', { class: 'title', style: 'display:block' }, a.title || '（タイトルなし）'),
          h('span', { class: 'sub', style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:4px' }, formatDate(a.date), ...chips),
          a.textLength ? null : h('span', { class: 'sub' }, '本文が空です')));
      return h('li', null, lbl);
    }));
    if (vis.length > 400) listEl.appendChild(h('li', { class: 'hint' }, `ほか ${vis.length - 400} 件（「すべて選ぶ」で一括選択できます）`));
    if (!vis.length) listEl.appendChild(h('li', { class: 'hint' }, '該当する記事はありません'));
  }
  function updateCount() {
    const n = rows.filter((r) => r.selected).length;
    countEl.textContent = `${n}件`;
    m.setActions(actions(n));
  }
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, ...[
    ['all', `すべて ${counts.all}`], ['new', `新しい記事 ${counts.new}`], ['updated', `更新あり ${counts.updated}`],
    ['attention', `下書き・要確認 ${counts.attention}`], ['same', `取り込み済み ${counts.same}`],
  ].filter(([k]) => k === 'all' || counts[k]).map(([k, label]) => {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === filter) }, label);
    b.addEventListener('click', () => { filter = k; $$('[role=tab]', tabs).forEach((x) => x.setAttribute('aria-selected', String(x === b))); renderList(); });
    return b;
  }));
  const st = plan.stats;
  const body = h('div', null,
    h('p', null, `${plan.kind === 'zip' ? 'ZIP' : 'XML'}から ${st.total} 件の記事を見つけました（公開 ${st.publish}・下書き ${st.draft}${st.other ? `・その他 ${st.other}` : ''}）。画像 ${st.images} 枚。`),
    plan.channel.title ? h('p', { class: 'hint' }, `noteアカウント：${plan.channel.title}`) : null,
    ...plan.warnings.map((w) => h('p', { class: 'note-box warn' }, w)),
    h('p', { class: 'note-box' }, '通常の記事は1記事＝1冊の本になります。下書き・予約・状態が分からない記事は最初は選ばれていません。', h('br'),
      '書き出しには有料部分の境界や価格は含まれません。本文を公開するかどうかは、あとで1冊ずつ決められます（最初はすべて非公開）。'),
    h('div', { class: 'row', style: 'display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px' },
      h('button', { type: 'button', class: 'btn small', onclick: () => { rows.forEach((r) => { if (r.state !== 'same') r.selected = true; }); renderList(); updateCount(); } }, 'すべて選ぶ'),
      h('button', { type: 'button', class: 'btn small', onclick: () => { rows.forEach((r) => { if (r.state !== 'same') r.selected = r.a.status === 'publish'; }); renderList(); updateCount(); } }, '公開記事だけ'),
      h('button', { type: 'button', class: 'btn small', onclick: () => { rows.forEach((r) => { r.selected = false; }); renderList(); updateCount(); } }, '選択を外す')),
    tabs, listEl);
  const cleanupUrls = () => { for (const rec of plan.images.values()) if (rec._url) URL.revokeObjectURL(rec._url); };
  const actions = (n) => [
    { label: 'キャンセル' },
    { label: `選んだ${n}件を本にする`, primary: true, disabled: n === 0, onClick: async (modal) => {
      try {
        const result = await applyImport(plan, rows.filter((r) => r.selected), fresh);
        modal.close('done');
        toast(`${result.created}冊を本棚に並べました${result.updated ? `・${result.updated}件を更新` : ''}`);
        afterApply(fresh, onDone);
      } catch (e) {
        console.error(e);
        await alertDialog(`保存できませんでした。${e.message || ''}\n端末の空き容量を確認してください。`, '保存エラー');
      }
      return false;
    } },
  ];
  const m = openModal({ title: '記事の確認', body, wide: true, actions: actions(0), onClose: cleanupUrls });
  renderList();
  updateCount();
}

async function applyImport(plan, selected, fresh) {
  if (!S.shop) {
    S.shop = defaultShop();
    const owner = plan.channel.title;
    if (owner) { S.shop.owner = owner; S.shop.name = `${owner}の小さな本屋`; }
    if (plan.channel.link && isNoteUrl(plan.channel.link)) S.shop.profileUrl = plan.channel.link;
  }
  const articles = [], books = [], neededImages = new Set();
  let order = Math.max(0, ...[...S.books.values()].map((b) => b.order || 0)) + 1;
  let created = 0, updated = 0;
  // newest article last on the shelf? note exports are oldest→newest; keep that reading order
  const sorted = [...selected].sort((x, y) => String(x.a.date).localeCompare(String(y.a.date)));
  for (const r of sorted) {
    const a = { ...r.a };
    if (r.existing) {
      a.id = r.existing.id; // keep id stable (matched by URL)
      if (r.state === 'updated') updated++;
    }
    articles.push(a);
    for (const im of a.images) { if (im.imageId) neededImages.add(im.imageId); for (const c of im.candidates) neededImages.add(c); }
    if (a.headImageId) neededImages.add(a.headImageId);
    const hasBook = [...S.books.values()].some((b) => b.articleIds.includes(a.id));
    if (!hasBook) {
      books.push(newBook({ title: a.title || '無題', articleIds: [a.id], shelfId: UNSORTED, order: order++ }));
      created++;
    }
  }
  const images = [...neededImages].map((id) => plan.images.get(id)).filter(Boolean).map(({ _url, ...rec }) => rec);
  if (fresh && !S.shop.featured.length) {
    // first import: put the 3 newest published books (preferring ones with a header image) face-out.
    // Only a starting point — the owner can change it any time.
    const artOf = (b) => articles.find((a) => a.id === b.articleIds[0]);
    const pub = books.filter((b) => artOf(b) && artOf(b).status === 'publish').sort((x, y) => String(artOf(y).date).localeCompare(String(artOf(x).date)));
    const pick = [...pub.filter((b) => artOf(b).headImageId), ...pub.filter((b) => !artOf(b).headImageId)].slice(0, 3);
    S.shop.featured = pick.map((b) => b.id);
  }
  // apply in memory to compute orphaned images (from replaced versions of updated articles)
  for (const a of articles) S.articles.set(a.id, a);
  for (const i of images) S.images.set(i.id, i);
  const refs = referencedImageIds();
  const orphans = [...S.images.keys()].filter((id) => !refs.has(id) && S.images.get(id).origin === 'zip');
  await saveAll({ shop: true, articles, books, images, delImages: orphans });
  return { created, updated };
}

function afterApply(fresh, onDone) {
  const done = () => onDone && onDone();
  openOrganizeSuggestions({
    onDone: () => {
      if (fresh) openThemePicker({ rerender: () => {}, firstTime: true, onDone: done });
      else done();
    },
    quietIfEmpty: true,
  });
}

export { excerpt, icon };
