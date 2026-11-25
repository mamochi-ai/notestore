// Boot + routing. Modes:
//   edit     – owner editing their local shop (IndexedDB)
//   preview  – owner sees exactly what visitors see (no edit controls)
//   view     – readonly: sample / shared link (#s=…) / published ZIP
import { h, $, toast } from './util.js';
import { getTheme, applyThemeVars, THEMES } from './themes.js';
import { S, loadLocal, loadReadonly, onSaveState, bookArticles, resetState } from './state.js';
import { mountShop, render, view } from './shelf.js';
import { icon, logo, btn, alertDialog } from './ui.js';
import { sampleData } from './sample.js';
import * as editor from './editor.js';
import { openReader } from './reader.js';
import { openShareCenter, readShareFromHash, loadPublishedData } from './share.js';
import { startImport } from './import-ui.js';
import { requestPersist } from './db.js';
import { openHelp, guideCard } from './help.js';

const app = { mode: 'edit', storageOk: true };
const appEl = () => document.getElementById('app');

export function rerender() { applyThemeVars(getTheme(S.shop && S.shop.theme)); render(); }

async function boot() {
  // 1) shared lightweight link
  if (location.hash.startsWith('#s=')) {
    try {
      const data = await readShareFromHash(location.hash.slice(3));
      loadReadonly('link', data);
      app.mode = 'view';
      showShop();
      return;
    } catch (e) {
      console.error(e);
      appEl().replaceChildren(errorScreen('共有リンクを開けませんでした', e.message || 'リンクが途中で切れているか、形式が正しくありません。'));
      return;
    }
  }
  // 2) published static bookshop (generated ZIP)
  const pub = document.querySelector('meta[name="bookshop-mode"]');
  if (pub && pub.content === 'published') {
    try {
      const data = await loadPublishedData();
      loadReadonly('published', data);
      app.mode = 'view';
      showShop();
    } catch (e) {
      appEl().replaceChildren(errorScreen('本屋のデータを読み込めませんでした', e.message || ''));
    }
    return;
  }
  // 3) owner's local shop
  let has = false;
  try { has = await loadLocal(); }
  catch (e) { console.error(e); app.storageOk = false; }
  if (has) { app.mode = 'edit'; showShop(); }
  else showWelcome();
}

function errorScreen(title, msg) {
  return h('div', { class: 'welcome' }, h('div', { class: 'welcome-card' }, logo(), h('h1', null, title), h('p', null, msg),
    h('p', null, h('a', { class: 'btn', href: location.pathname }, 'トップへ'))));
}

export function showWelcome() {
  applyThemeVars(THEMES[0]);
  const fileInput = h('input', { type: 'file', accept: '.zip,.xml,application/zip,application/xml,text/xml', class: 'visually-hidden', 'aria-label': 'noteのエクスポートファイル' });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) startImport(fileInput.files[0], { fresh: true, onDone: afterImport }); fileInput.value = ''; });
  const card = h('div', { class: 'welcome-card' },
    logo(),
    h('h1', null, 'わたしの小さな本屋'),
    h('p', null, 'noteに書いてきた記事を、一冊ずつ本にして棚に並べます。', h('br'), '表紙や背表紙、店主のPOPで、あなたの作品を見つけてもらう本屋です。'),
    h('div', { class: 'welcome-actions' },
      btn('noteの記事を読み込む', () => fileInput.click(), { cls: 'primary', iconName: 'upload' }),
      btn('サンプルの本屋を見る', showSample, { iconName: 'eye' }),
      btn('使い方を見る', () => openHelp({}), { iconName: 'book' }),
      fileInput),
    h('p', { class: 'fine' }, 'noteのWebサイト（アプリでは不可）で、プロフィールアイコン →「自分の記事」→「エクスポート」で書き出したZIPを選んでください。くわしい手順は「使い方を見る」にあります。ファイルはこの端末の中だけで処理され、どこにも送信されません。'),
    app.storageOk ? null : h('p', { class: 'note-box warn' }, 'この環境では端末への保存が使えないようです（プライベートブラウズなど）。サンプルは見られますが、本屋を保存できません。'),
    h('p', { class: 'fine' }, h('button', { class: 'link', type: 'button', onclick: () => editor.openRestoreFromWelcome(afterImport) }, 'バックアップから復元する')),
  );
  appEl().replaceChildren(h('main', { class: 'welcome' }, h('div', { class: 'welcome-bg', style: `background-image:url("${THEMES[0].img}")` }), card));
}

function showSample() {
  loadReadonly('sample', sampleData());
  app.mode = 'view';
  view.tab = 'all'; view.selected = null;
  showShop();
}

async function afterImport() {
  try { await loadLocal(); } catch (e) { toast(e.message, 'error'); }
  app.mode = 'edit';
  view.tab = 'all'; view.selected = null;
  requestPersist();
  showShop();
}

export function showShop() {
  applyThemeVars(getTheme(S.shop.theme));
  const editing = app.mode === 'edit';
  document.title = `${S.shop.name || 'わたしの小さな本屋'}`;
  mountShop(appEl(), {
    editing,
    editBar: editing ? editBar : null,
    banner: bannerFor,
    headerActions,
    footer,
    canRead,
    onRead: (b, opts = {}) => openReader(b, opts),
    editTools: editing ? (b) => editor.bookTools(b, ctxApi) : null,
    guide: editing ? () => guideCard() : null,
  });
}

const ctxApi = {
  rerender,
  showShop,
  afterImport,
  goWelcome: () => { resetState('local', 'local'); showWelcome(); },
};

function canRead(b) {
  const arts = bookArticles(b);
  if (!arts.length) return false;
  if (S.source === 'local' || S.source === 'sample') return arts.some((a) => a.html);
  if (S.source === 'published') return !!b.shareBody && arts.some((a) => a.html);
  return false;
}

function headerActions() {
  const owner = btn('店主', () => { view.owner = true; view.selected = null; render(); }, { cls: 'ghost small', iconName: 'user', attrs: { 'aria-label': '店主について' } });
  const list = [owner];
  // visitors of a shared / published shop get a short "how to browse"; the sample shows the owner's guide
  if (S.source === 'link' || S.source === 'published') list.unshift(btn('見かた', () => openHelp({ audience: 'visitor' }), { cls: 'ghost small', iconName: 'book' }));
  else if (S.source === 'sample') list.unshift(btn('使い方', () => openHelp({}), { cls: 'ghost small', iconName: 'book' }));
  if (app.mode === 'edit') {
    list.push(btn('お店をシェア', () => openShareCenter(ctxApi), { cls: 'small', iconName: 'share' }));
  }
  return list;
}

function editBar() {
  const st = h('span', { class: 'save-state', 'data-state': S.saveState, role: 'status', 'aria-live': 'polite' }, saveLabel(S.saveState));
  const unsub = onSaveState((state, err) => {
    if (!st.isConnected) { unsub(); return; }
    st.dataset.state = state; st.textContent = saveLabel(state, err);
    if (state === 'error') toast(err && err.message ? err.message : '保存できませんでした', 'error', 6000);
  });
  return h('div', { class: 'editbar', role: 'toolbar', 'aria-label': '本屋の編集' },
    h('span', { class: 'tag' }, '編集中'),
    btn('記事を読み込む', () => editor.openImportPicker(ctxApi), { iconName: 'upload' }),
    btn('本と連載', () => editor.openBookManager(ctxApi), { iconName: 'layers' }),
    btn('棚', () => editor.openShelfManager(ctxApi), { iconName: 'shelves' }),
    btn('テーマ', () => editor.openThemePicker(ctxApi), { iconName: 'palette' }),
    btn('お店の設定', () => editor.openShopSettings(ctxApi), { iconName: 'gear' }),
    btn('シェア', () => openShareCenter(ctxApi), { iconName: 'share' }),
    btn('使い方', () => openHelp({}), { iconName: 'book' }),
    btn('プレビュー', () => { app.mode = 'preview'; view.selected = null; showShop(); window.scrollTo(0, 0); }, { cls: 'primary', iconName: 'eye' }),
    st);
}
function saveLabel(s, err) {
  return s === 'saving' ? '保存中…' : s === 'saved' ? '端末に保存済み' : s === 'error' ? '⚠ 保存できませんでした' : '端末に保存';
}

function bannerFor() {
  if (app.mode === 'preview') {
    return h('div', { class: 'banner', role: 'note' }, h('span', null, 'プレビュー：訪問者にはこのように見えます。'),
      btn('編集に戻る', () => { app.mode = 'edit'; view.selected = null; showShop(); }, { cls: 'small primary', iconName: 'edit' }));
  }
  if (S.source === 'sample') {
    return h('div', { class: 'banner', role: 'note' }, h('span', null, 'これは架空のサンプルの本屋です。'),
      btn('noteの記事を読み込む', () => editor.openImportPicker({ ...ctxApi, fresh: true }), { cls: 'small primary', iconName: 'upload' }),
      btn('最初の画面へ', () => { resetState('local', 'local'); boot(); }, { cls: 'small' }));
  }
  if (S.source === 'link') {
    return h('div', { class: 'banner', role: 'note' }, h('span', null, '紹介リンクで共有された本屋です（文字の表紙で表示しています）。'));
  }
  return null;
}

function footer() {
  const f = h('footer', { class: 'footer' });
  if (S.source === 'link' || S.source === 'published') {
    f.append('わたしの小さな本屋');
  } else if (app.mode === 'edit') {
    f.append('データはこの端末のブラウザ内に保存されています。定期的に「お店の設定」からバックアップを書き出してください。');
  }
  return f;
}

window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#s=')) location.reload();
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
});

boot();
