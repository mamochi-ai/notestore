// End-to-end checks in headless Chromium (NOT a substitute for iPad/iPhone Safari on device).
// Usage: node tests/e2e.cjs            (synthetic fixtures only)
//        NOTE_EXPORT_ZIP=/path/to/your-note-export.zip node tests/e2e.cjs   (+ real export checks)
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'bookshop-e2e-'));
const FX = path.join(OUT, 'fx');
const SHOTS = process.env.SHOTS || path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 8130, PUB_PORT = 8131;
const BASE = `http://localhost:${PORT}/`;
const results = [];
let browser, server, pubServer;

function log(ok, name, info = '') { results.push({ ok, name, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
async function test(name, fn) {
  try { const info = await fn(); log(true, name, info || ''); }
  catch (e) { log(false, name, (e && e.stack || String(e)).split('\n').slice(0, 3).join(' | ')); }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

async function newPage(vp = { width: 1024, height: 768 }, ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true, ...ctxOpts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.requests = [];
  page.on('request', (r) => page.requests.push(r.url()));
  return { ctx, page };
}
// evaluated through DevTools (not subject to the page CSP, which forbids eval in page scripts)
const S = (page, fn, arg) => page.evaluate(`(async () => { const st = await import('/app/js/state.js'); return (${fn.toString()})(st, ${JSON.stringify(arg ?? null)}); })()`);

async function importFile(page, file, { select = 'default', suggestions = 'skip', theme = null } = {}) {
  await page.waitForSelector('.welcome, .editbar');
  if (await page.locator('.welcome').count()) {
    await page.locator('.welcome input[type=file]').setInputFiles(file);
  } else {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.editbar button', { hasText: '記事を読み込む' }).click()]);
    await fc.setFiles(file);
  }
  const which = await Promise.race([
    page.waitForSelector('text=記事の確認', { timeout: 120000 }).then(() => 'review'),
    page.waitForSelector('text=読み込めませんでした', { timeout: 120000 }).then(() => 'error'),
  ]);
  if (which === 'error') return { error: await page.locator('.modal .body').innerText() };
  const warnings = await page.locator('.modal .note-box.warn').allInnerTexts();
  const summary = await page.locator('.modal .body > div > p').first().innerText();
  if (select === 'all') await page.locator('.modal button', { hasText: 'すべて選ぶ' }).click();
  const btn = page.locator('.modal footer button', { hasText: '本にする' });
  const label = await btn.innerText();
  if (await btn.isDisabled()) { await page.locator('.modal footer button', { hasText: 'キャンセル' }).click(); return { summary, warnings, label, applied: false }; }
  await btn.click();
  // suggestions (optional) → theme (first time)
  for (let i = 0; i < 3; i++) {
    const t = await Promise.race([
      page.waitForSelector('text=整理の提案', { timeout: 15000 }).then(() => 'sugg'),
      page.waitForSelector('text=あなたの本屋は、どんな場所？', { timeout: 15000 }).then(() => 'theme'),
      page.waitForSelector('.editbar', { timeout: 15000 }).then(async () => { await page.waitForTimeout(300); return (await page.locator('.modal').count()) ? 'wait' : 'done'; }),
    ]).catch(() => 'done');
    if (t === 'sugg') {
      if (suggestions === 'accept') for (const cb of await page.locator('.modal .note-box input[type=checkbox]').all()) await cb.check();
      await page.locator('.modal footer button', { hasText: suggestions === 'accept' ? '選んだ提案を使う' : 'あとで' }).click();
    } else if (t === 'theme') {
      if (theme) await page.locator('.theme-card').nth(['warm', 'library', 'abandoned', 'overseas', 'luxury', 'future'].indexOf(theme)).click();
      await page.locator('.modal footer button').last().click();
    } else if (t === 'done') break;
    await page.waitForTimeout(200);
  }
  await page.waitForSelector('.editbar');
  return { summary, warnings, label, applied: true };
}

(async () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tests/fixtures/make-fixtures.mjs'), FX]);
  server = spawn(process.execPath, [path.join(ROOT, 'tests/serve.mjs'), String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  browser = await chromium.launch();

  // ---------- sample + six themes ----------
  await test('サンプルの本屋（閲覧モードに編集UIが無い）と6テーマ切替', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    await page.getByText('サンプルの本屋を見る').click();
    await page.waitForSelector('.bay .book');
    assert(!(await page.locator('.editbar, .edit-tools').count()), 'edit UI visible in sample view');
    const themes = ['warm', 'library', 'abandoned', 'overseas', 'luxury', 'future'];
    for (const t of themes) {
      await page.evaluate(async (t) => { const st = await import('/app/js/state.js'); st.S.shop.theme = t; (await import('/app/js/main.js')).rerender(); }, t);
      await page.waitForTimeout(250);
      const bg = await page.locator('.bay').first().evaluate((e) => e.style.backgroundImage);
      assert(bg.includes(`${t}.jpg`), `bay bg for ${t}: ${bg}`);
      assert((await page.getAttribute('html', 'data-theme')) === t, 'data-theme');
      await page.screenshot({ path: path.join(SHOTS, `theme-${t}.png`) });
    }
    // contrast: book title color differs from book color on dark themes
    assert(!page.errors.length, page.errors.join('; '));
    await ctx.close();
    return '6 themes rendered';
  });

  // ---------- import with images ----------
  let shopCtx, shop;
  await test('ZIP取込：見出し画像の判定・URLエンコードされた画像パス・欠損画像の扱い', async () => {
    ({ ctx: shopCtx, page: shop } = await newPage());
    await shop.goto(BASE);
    const r = await importFile(shop, path.join(FX, 'with-images.zip'), { select: 'all', suggestions: 'skip', theme: 'warm' });
    assert(r.applied, 'not applied');
    assert(r.warnings.some((w) => w.includes('見つからなかった画像参照が 1 件')), 'missing image warning: ' + r.warnings.join('/'));
    const info = await S(shop, (st) => [...st.S.articles.values()].map((a) => ({ t: a.title, head: !!a.headImageId, imgs: a.images.map((i) => !!i.imageId) })));
    const a1 = info.find((a) => a.t.includes('第1話'));
    assert(a1.head, 'head image not detected');
    assert(a1.imgs.every(Boolean), 'encoded path image not resolved: ' + JSON.stringify(a1));
    const a2 = info.find((a) => a.t.includes('第2話'));
    assert(!a2.head && a2.imgs[0] === false, 'article2 should have no head / missing image');
    assert((await shop.locator('.book .book-art').count()) >= 1, 'cover image not shown on shelf');
    return JSON.stringify(info);
  });

  await test('連載のまとめ（提案）→章の並べ替え→解除で元の本に戻る', async () => {
    const page = shop;
    const ids = await S(page, (st) => [...st.S.books.values()].filter((b) => !b.hidden).map((b) => b.id));
    await page.locator('.editbar button', { hasText: '本と連載' }).click();
    await page.locator('.modal button', { hasText: '連載・短編集をつくる' }).click();
    await page.locator('.modal input[type=text]').first().fill('画像つき記事');
    for (const cb of await page.locator('.modal ul.list input[type=checkbox]').all()) await cb.check();
    await page.locator('.modal footer button', { hasText: '1冊にまとめる' }).click();
    await page.waitForTimeout(300);
    const serial = await S(page, (st) => { const b = [...st.S.books.values()].find((x) => x.kind === 'serial'); return b && { id: b.id, ids: b.articleIds, hidden: [...st.S.books.values()].filter((x) => x.hidden).length }; });
    assert(serial && serial.ids.length === 2 && serial.hidden === 2, 'serial not created ' + JSON.stringify(serial));
    // reorder: open series editor and move chapter 1 down
    await page.evaluate(async () => { const e = await import('/app/js/editor.js'); const st = await import('/app/js/state.js'); e.openSeriesEditor({ book: [...st.S.books.values()].find((x) => x.kind === 'serial') }); });
    await page.getByRole('button', { name: '1章を後ろへ' }).click();
    await page.locator('.modal footer button', { hasText: '保存' }).click();
    await page.waitForTimeout(300);
    const after = await S(page, (st) => [...st.S.books.values()].find((x) => x.kind === 'serial').articleIds);
    assert(after[0] === serial.ids[1] && after[1] === serial.ids[0], 'order not changed');
    // persisted?
    const persisted = await page.evaluate(async () => { const db = await import('/app/js/db.js'); return (await db.getAll('books')).find((b) => b.kind === 'serial').articleIds; });
    assert(JSON.stringify(persisted) === JSON.stringify(after), 'order not persisted');
    return `chapters ${serial.ids.join(',')} → ${after.join(',')}`;
  });

  await test('装丁：表紙と背表紙に別画像・位置と拡大の調整（伸ばさず切り抜き）', async () => {
    const page = shop;
    const png = path.join(OUT, 'upload.png');
    // 400x200 gradient PNG made in the browser
    const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 200; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 400, 0); g.addColorStop(0, '#c33'); g.addColorStop(1, '#33c'); x.fillStyle = g; x.fillRect(0, 0, 400, 200); return c.toDataURL('image/png').split(',')[1]; });
    fs.writeFileSync(png, Buffer.from(b64, 'base64'));
    await page.locator('.bay-row:not(.featured) .book').first().click();
    await page.getByRole('button', { name: '装丁・POPを編集' }).click();
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.modal button', { hasText: '画像をアップロード' }).click()]);
    await fc.setFiles(png);
    await page.waitForSelector('.crop-frame');
    await page.locator('.modal .seg button', { hasText: '全面' }).click();
    await page.locator('.modal input[type=range]').nth(0).fill('20');
    await page.locator('.modal input[type=range]').nth(2).fill('1.5');
    await page.getByRole('tab', { name: '背表紙' }).click();
    const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.modal button', { hasText: '画像をアップロード' }).click()]);
    await fc2.setFiles(png);
    await page.waitForSelector('.crop-frame');
    await page.getByRole('tab', { name: '紹介・おすすめ' }).click();
    await page.getByLabel('店主のおすすめ理由（120字まで・棚のPOPにもなります）').fill('この記事から、全部始まりました。');
    await page.getByLabel('こんな人へ（80字まで）').fill('最初の一歩で止まっている人へ');
    await page.locator('.modal footer button', { hasText: '保存' }).click();
    await page.waitForTimeout(400);
    const d = await S(page, (st) => { const b = st.S.books.get(document.querySelector('.detail .book')?.dataset.id) || [...st.S.books.values()].find((x) => x.pop); return { cover: b.design.coverImageId, spine: b.design.spineImageId, pos: b.design.coverPos, pop: b.pop, forWhom: b.forWhom, layout: b.design.coverLayout }; });
    assert(d.forWhom === '最初の一歩で止まっている人へ', 'forWhom not saved');
    assert(d.cover && d.spine && d.cover !== d.spine, 'separate cover/spine images ' + JSON.stringify(d));
    assert(d.pos.x === 20 && d.pos.s === 1.5, 'crop not saved ' + JSON.stringify(d.pos));
    const fit = await page.locator('.detail .book .book-art').first().evaluate((i) => getComputedStyle(i).objectFit);
    assert(fit === 'cover', 'object-fit ' + fit);
    return JSON.stringify(d);
  });

  await test('再取込：重複は「取り込み済み」、更新は本文だけ反映し装丁・POP・連載順を保持', async () => {
    const page = shop;
    const before = await S(page, (st) => [...st.S.books.values()].map((b) => ({ id: b.id, pop: b.pop, d: JSON.stringify(b.design), ids: b.articleIds.join(','), title: b.title })));
    const r = await importFile(page, path.join(FX, 'with-images.zip'));
    assert(!r.applied && /選んだ0件/.test(r.label), 'duplicates should not be preselected: ' + r.label);
    // modified export: change article 2 text
    const JSZ = await import(path.join(ROOT, 'app/vendor/fflate.js'));
    const src = fs.readFileSync(path.join(FX, 'with-images.zip'));
    const files = JSZ.unzipSync(new Uint8Array(src));
    const xml = Buffer.from(files['note-test-1.xml']).toString('utf8').replace('<p>本文</p>', '<p>本文を更新しました</p>');
    files['note-test-1.xml'] = new Uint8Array(Buffer.from(xml));
    const modZip = path.join(OUT, 'with-images-updated.zip');
    fs.writeFileSync(modZip, Buffer.from(JSZ.zipSync(files)));
    const r2 = await importFile(page, modZip);
    assert(r2.applied && /選んだ1件/.test(r2.label), 'updated article should be preselected: ' + r2.label);
    const after = await S(page, (st) => [...st.S.books.values()].map((b) => ({ id: b.id, pop: b.pop, d: JSON.stringify(b.design), ids: b.articleIds.join(','), title: b.title })));
    const diff = after.filter((x) => JSON.stringify(x) !== JSON.stringify(before.find((y) => y.id === x.id)));
    assert(!diff.length && before.length === after.length, 'book settings changed by re-import: ' + JSON.stringify(diff) + ' vs ' + JSON.stringify(before.filter((y) => diff.some((d) => d.id === y.id))));
    const html = await S(page, (st) => [...st.S.articles.values()].find((a) => a.title.includes('第2話')).html);
    assert(html.includes('本文を更新しました'), 'article not updated');
    return `${after.length} books unchanged`;
  });

  await test('バックアップ書き出し→全削除→別環境で復元', async () => {
    const page = shop;
    await page.evaluate(async () => { const st = await import('/app/js/state.js'); const b = [...st.S.books.values()].find((x) => !x.hidden); b.paywall = { [b.articleIds[0]]: { at: 1, text: '' } }; await st.saveBooks([b]); });
    const counts = await S(page, (st) => ({ b: st.S.books.size, a: st.S.articles.size, i: st.S.images.size, theme: st.S.shop.theme }));
    await page.locator('.editbar button', { hasText: 'お店の設定' }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.modal button', { hasText: 'バックアップを書き出す' }).click()]);
    const file = path.join(OUT, 'backup.zip');
    await dl.saveAs(file);
    await page.keyboard.press('Escape');
    // restore into a completely fresh context (another device)
    const { ctx, page: p2 } = await newPage();
    await p2.goto(BASE);
    await p2.locator('.welcome button', { hasText: 'バックアップから復元する' }).click().catch(() => {});
    const [fc] = await Promise.all([p2.waitForEvent('filechooser'), p2.locator('.welcome button', { hasText: 'バックアップから復元する' }).click()]);
    await fc.setFiles(file);
    await p2.locator('.modal footer button', { hasText: '復元する' }).click();
    await p2.waitForSelector('.editbar');
    const c2 = await S(p2, (st) => ({ b: st.S.books.size, a: st.S.articles.size, i: st.S.images.size, theme: st.S.shop.theme }));
    const fw = await S(p2, (st) => [...st.S.books.values()].some((b) => b.forWhom === '最初の一歩で止まっている人へ'));
    assert(fw, 'forWhom lost in backup/restore');
    const pw = await S(p2, (st) => [...st.S.books.values()].some((b) => b.paywall && Object.values(b.paywall).some((v) => v.at === 1)));
    assert(pw, 'paywall lost in backup/restore');
    assert(JSON.stringify(c2) === JSON.stringify(counts), `mismatch ${JSON.stringify(counts)} vs ${JSON.stringify(c2)}`);
    const imgOk = await p2.locator('.book .book-art').first().evaluate((i) => new Promise((r) => (i.complete ? r(i.naturalWidth > 0) : (i.onload = () => r(i.naturalWidth > 0)))));
    assert(imgOk, 'restored image not displayed');
    await ctx.close();
    return `${fs.statSync(file).size} bytes, ${JSON.stringify(c2)}`;
  });

  // ---------- security ----------
  let evilCtx, evil;
  await test('危険なHTML：script/iframe/イベント属性/javascript:を除去・外部画像を自動取得しない', async () => {
    ({ ctx: evilCtx, page: evil } = await newPage());
    await evil.goto(BASE);
    await importFile(evil, path.join(FX, 'evil.xml'), { select: 'all' });
    const art = await S(evil, (st) => [...st.S.articles.values()].find((a) => a.title.startsWith('危険')).html);
    for (const bad of ['<script', 'onerror', 'onclick', 'javascript:', '<iframe', '<object', '<form', '<input', 'style=', '<svg', '<math']) assert(!art.toLowerCase().includes(bad), `found ${bad} in ${art}`);
    assert(art.includes('<ruby>漢字<rt>かんじ</rt></ruby>'), 'ruby lost');
    assert(art.includes('href="https://note.com/ok"'), 'good link lost');
    await evil.locator('.bay .book').first().click();
    await evil.getByRole('button', { name: 'この本を読む' }).click();
    await evil.waitForSelector('.reader');
    await evil.waitForTimeout(400);
    const xss = await evil.evaluate(() => window.__xss);
    assert(xss === undefined, 'script executed: ' + xss);
    assert(!evil.requests.some((u) => u.includes('tracker.example') || u.includes('evil.example')), 'external request made');
    assert(await evil.locator('.reader .img-missing', { hasText: '外部の画像' }).count() === 1, 'external image placeholder');
    await evil.keyboard.press('Escape');
    return 'sanitized';
  });

  await test('共有データに未選択の本文・下書き・状態不明が含まれない', async () => {
    const page = evil;
    const res = await page.evaluate(async () => {
      const share = await import('/app/js/share.js');
      const st = await import('/app/js/state.js');
      const all = new Set([...st.S.books.keys()]);
      const m = share.buildPublicModel({ ids: all, bodyIds: new Set(), images: true });
      const m2 = share.buildPublicModel({ ids: all, bodyIds: all, images: true });
      const { url } = share.encodeLink(m);
      const back = await share.readShareFromHash(url.split('#s=')[1]);
      return { json: JSON.stringify({ ...m, images: [...m.images.keys()] }), json2: JSON.stringify({ ...m2, images: [] }), n: m.books.length, titles: back.books.map((b) => b.title) };
    });
    for (const s of ['SECRET_DRAFT_TEXT', 'UNKNOWN_STATUS_TEXT', '下書きの記事', '状態不明の記事']) {
      assert(!res.json.includes(s), `${s} leaked (no body)`);
      assert(!res.json2.includes(s), `${s} leaked (body requested)`);
    }
    assert(!res.json.includes('"body"'), 'body present though not selected');
    assert(res.n === 1 && res.titles.length === 1, 'only published book expected');
    return `books in share: ${res.n}`;
  });

  await test('DOCTYPE入りXML・壊れたXML・壊れたZIPを拒否／パストラバーサルを無視', async () => {
    const out = [];
    for (const [f, expect] of [['doctype.xml', 'DOCTYPE'], ['broken.xml', '形式が正しくありません'], ['broken.zip', 'ZIP']]) {
      const { ctx, page } = await newPage();
      await page.goto(BASE);
      const r = await importFile(page, path.join(FX, f));
      assert(r.error && r.error.includes(expect), `${f}: ${JSON.stringify(r)}`);
      out.push(f);
      await ctx.close();
    }
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    const r = await importFile(page, path.join(FX, 'traversal.zip'), { select: 'all' });
    assert(r.warnings.some((w) => w.includes('安全でないパス')), 'traversal warning missing');
    assert(r.applied, 'traversal zip should still import the safe parts');
    await ctx.close();
    return out.join(', ') + ' rejected; traversal entry ignored';
  });

  // ---------- link share in another environment ----------
  await test('紹介リンク：別環境で閲覧でき、閲覧側に編集UIなし・所有者の本棚を上書きしない', async () => {
    const page = shop;
    const url = await page.evaluate(async () => {
      const share = await import('/app/js/share.js'); const st = await import('/app/js/state.js');
      return share.encodeLink(share.buildPublicModel({ ids: new Set(st.S.books.keys()) })).url;
    });
    const { ctx, page: v } = await newPage({ width: 390, height: 844 });
    await v.goto(url);
    await v.waitForSelector('.bay .book');
    assert(!(await v.locator('.editbar, .edit-tools').count()), 'edit UI in shared view');
    const dbs = await v.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : []));
    assert(!dbs.includes('little-bookshop'), 'shared view created owner DB');
    await v.screenshot({ path: path.join(SHOTS, 'shared-link-phone.png') });
    await ctx.close();
    // same browser as owner: owner data must stay intact
    const before = await S(page, (st) => st.S.books.size);
    const p3 = await shopCtx.newPage();
    await p3.goto(url);
    await p3.waitForSelector('.bay .book');
    await p3.close();
    const n = await page.evaluate(async () => (await (await import('/app/js/db.js')).getAll('books')).length);
    assert(n === before, `owner books changed ${before} → ${n}`);
    return `url length ${url.length}`;
  });

  // ---------- 1000 articles ----------
  await test('1000記事：取込・描画・検索・URL上限の案内', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    const t0 = Date.now();
    const r = await importFile(page, path.join(FX, 'big-1000.xml'), { select: 'all' });
    const tImport = Date.now() - t0;
    const n = await page.locator('.bay .book').count();
    assert(n >= 990, 'books rendered ' + n);
    const t1 = Date.now();
    await page.evaluate(() => (async () => { const s = await import('/app/js/shelf.js'); s.render(); })());
    const tRender = Date.now() - t1;
    await page.mouse.wheel(0, 20000);
    await page.locator('.search .icon-btn').click();
    await page.locator('.search input').fill('English Title 15');
    await page.waitForTimeout(500);
    const hits = await page.locator('.bay .book').count();
    assert(hits >= 1 && hits < 20, 'search hits ' + hits);
    // URL limit
    await page.locator('.search input').fill('');
    await page.locator('.editbar button', { hasText: 'シェア' }).click();
    await page.locator('.modal button', { hasText: 'リンクをつくる' }).click();
    await page.locator('.modal footer button', { hasText: 'この内容でリンクをつくる' }).click();
    await page.waitForSelector('text=リンクが長すぎます');
    const msg = await page.locator('.modal [role=alert]').innerText();
    assert(page.errors.length === 0, page.errors.join(';'));
    await ctx.close();
    return `import+review ${tImport}ms, re-render ${tRender}ms, ${n} books; ${msg.slice(0, 60)}`;
  });

  // ---------- vertical reader + rotation ----------
  await test('縦書き：回転（1024×768→768×1024）と文字サイズ変更で位置を保ち本文が欠けない', async () => {
    const { ctx, page } = await newPage({ width: 1024, height: 768 });
    await page.goto(BASE);
    await page.getByText('サンプルの本屋を見る').click();
    await page.evaluate(async () => {
      const st = await import('/app/js/state.js'); const r = await import('/app/js/reader.js');
      const b = st.S.books.get('bk8'); const a = st.S.articles.get('s8'); a.html = '<p>' + '縦書きの本文です。数字12と、English words、「かぎかっこ」。'.repeat(120) + '</p><p>最後の一文です。</p>';
      r.openReader(b, { startChapter: 0 });
    });
    await page.waitForSelector('.reading-paper.vertical');
    const text0 = await page.locator('.reading-paper .chapter').innerText();
    await page.waitForTimeout(400);
    await page.evaluate(() => { const p = document.querySelector('.reading-paper'); p.scrollLeft = -(p.scrollWidth - p.clientWidth) * 0.5; });
    await page.waitForTimeout(400);
    const r0 = await page.evaluate(() => { const p = document.querySelector('.reading-paper'); return Math.abs(p.scrollLeft) / (p.scrollWidth - p.clientWidth); });
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(700);
    const r1 = await page.evaluate(() => { const p = document.querySelector('.reading-paper'); return Math.abs(p.scrollLeft) / (p.scrollWidth - p.clientWidth); });
    const text1 = await page.locator('.reading-paper .chapter').innerText();
    assert(text0 === text1, 'text changed after rotation');
    assert(Math.abs(r1 - r0) < 0.08, `position drift ${r0.toFixed(2)} → ${r1.toFixed(2)}`);
    assert((await page.locator('.reading-paper .tcy').count()) > 0, 'tate-chu-yoko missing');
    await page.screenshot({ path: path.join(SHOTS, 'reader-vertical-portrait.png') });
    await page.locator('.reader-top button[aria-label="表示の設定"]').click();
    await page.locator('.reader-pop button', { hasText: '特大' }).click();
    await page.waitForTimeout(300);
    const text2 = await page.locator('.reading-paper .chapter').innerText();
    assert(text2 === text0, 'text changed after font size');
    await ctx.close();
    return `ratio ${r0.toFixed(3)} → ${r1.toFixed(3)}`;
  });

  // ---------- shelf layout ----------
  await test('棚の配置：保存順を維持・背表紙は密着・本の下端とブックエンドが棚板に接地・少ない棚は中央寄せ', async () => {
    const out = [];
    for (const vp of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
      const { ctx, page } = await newPage(vp);
      await page.goto(BASE);
      await page.getByText('サンプルの本屋を見る').click();
      await page.waitForSelector('.bay .book');
      for (const t of ['warm', 'library', 'abandoned', 'overseas', 'luxury', 'future']) {
        await page.evaluate(async (t) => { const st = await import('/app/js/state.js'); st.S.shop.theme = t; (await import('/app/js/main.js')).rerender(); }, t);
        const r = await page.evaluate(async () => {
          const st = await import('/app/js/state.js');
          const res = { order: true, bottom: 0, gaps: [], ends: 0, center: 0 };
          for (const row of document.querySelectorAll('.bay-row:not(.featured)')) {
            const rb = row.getBoundingClientRect();
            const kids = [...row.children];
            for (const k of kids) {
              if (k.classList.contains('book') || k.classList.contains('pop-mini') || k.classList.contains('bookend')) res.bottom = Math.max(res.bottom, Math.abs(k.getBoundingClientRect().bottom - rb.bottom));
            }
            for (let i = 1; i < kids.length; i++) {
              const a = kids[i - 1], b = kids[i];
              const gap = b.getBoundingClientRect().left - a.getBoundingClientRect().right;
              if (a.classList.contains('spine') && b.classList.contains('spine')) res.gaps.push(gap);
              if (b.classList.contains('bookend') || a.classList.contains('bookend')) res.ends = Math.max(res.ends, gap);
            }
            if (row.classList.contains('centered')) {
              const first = kids[0].getBoundingClientRect(), last = kids[kids.length - 1].getBoundingClientRect();
              res.center = Math.max(res.center, Math.abs((first.left - rb.left) - (rb.right - last.right)));
            }
          }
          // order per shelf must follow saved order
          for (const s of st.S.shop.shelves) {
            const want = st.booksOnShelf(s.id).map((b) => b.id);
            const sec = [...document.querySelectorAll('.shelf-group')].find((g) => g.getAttribute('aria-label') === s.name);
            if (!sec) continue;
            const got = [...sec.querySelectorAll('.book')].map((e) => e.dataset.id);
            if (JSON.stringify(got) !== JSON.stringify(want)) res.order = false;
          }
          return res;
        });
        assert(r.order, `${t}@${vp.width}: order changed`);
        assert(r.bottom <= 1, `${t}@${vp.width}: item not on shelf (${r.bottom}px)`);
        assert(r.gaps.every((g) => g >= 0 && g <= 2), `${t}@${vp.width}: spine gaps ${r.gaps}`);
        assert(r.ends <= 2, `${t}@${vp.width}: bookend not against book (${r.ends}px)`);
        assert(r.center <= 2, `${t}@${vp.width}: group not centred (${r.center}px)`);
      }
      out.push(vp.width);
      await ctx.close();
    }
    return `6テーマ × 幅 ${out.join('/')}`;
  });

  await test('本の詳細：情報の順番・読了目安・未入力項目の非表示・目次から章を直接開く', async () => {
    const { ctx, page } = await newPage({ width: 1024, height: 768 });
    await page.goto(BASE);
    await page.getByText('サンプルの本屋を見る').click();
    await page.locator('.bay .book.spine[data-id="bk8"]').click();
    const order = await page.locator('.detail').evaluate((d) => [...d.children].map((c) => c.className || c.tagName).join('|'));
    const idx = (k) => order.indexOf(k);
    assert(idx('detail-cover') < idx('meta') && idx('meta') < idx('blurb') && idx('blurb') < idx('reco') && idx('reco') < idx('detail-actions') && idx('detail-actions') < idx('chapters'), 'panel order: ' + order);
    const chips = await page.locator('.detail .meta').innerText();
    assert(/読了目安 約\d+分/.test(chips), 'reading time missing: ' + chips);
    // book with no forWhom / pop / blurb → no empty headings
    await page.locator('.bay .book.spine[data-id="bk4"]').click();
    assert(!(await page.locator('.detail .reco, .detail .blurb').count()), 'empty sections shown');
    // TOC: open chapter 3 directly
    await page.locator('.bay .book.spine[data-id="bk8"]').click();
    await page.locator('.detail .chapters .ch-link').nth(2).click();
    await page.waitForSelector('.reader');
    const t = await page.locator('.reader .ch-title').innerText();
    assert(t.includes('第3話'), 'wrong chapter opened: ' + t);
    await page.locator('.reader-bottom button', { hasText: '前の章' }).click();
    assert((await page.locator('.reader .ch-title').innerText()).includes('第2話'), 'prev chapter');
    await page.locator('.reader-bottom button', { hasText: '次の章' }).click();
    assert((await page.locator('.reader .ch-title').innerText()).includes('第3話'), 'next chapter');
    // explicit chapter ignores saved position; plain "read" resumes it
    await page.locator('.reader .btn.back').click();
    await page.waitForSelector('.reader', { state: 'detached' });
    await page.locator('.detail .chapters .ch-link').nth(0).click();
    assert((await page.locator('.reader .ch-title').innerText()).includes('第1話'), 'explicit chapter 1');
    await page.locator('.reader .btn.back').click();
    await page.locator('.detail button', { hasText: 'この本を読む' }).click();
    assert((await page.locator('.reader .ch-title').innerText()).includes('第1話'), 'resume last chapter');
    await page.keyboard.press('Escape');
    assert(!(await page.locator('.reader').count()), 'Escape back to shelf');
    // the reading-time constant lives in one place
    const cpm = await page.evaluate(async () => (await import('/app/js/readtime.js')).CHARS_PER_MINUTE);
    assert(cpm === 500, 'cpm');
    // link-shared book without body: no reading time, chapters link to note only
    await ctx.close();
    return order.split('|').join(' > ');
  });

  await test('読書画面：短い章は紙面が中央・長い章は最後まで読める（縦/横・iPhone/iPad）', async () => {
    const res = [];
    for (const vp of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
      const { ctx, page } = await newPage(vp);
      await page.goto(BASE);
      await page.getByText('サンプルの本屋を見る').click();
      await page.evaluate(async () => {
        const st = await import('/app/js/state.js');
        st.S.articles.get('s9').html = '<h2>見出し</h2><p>' + '長い章の本文です。数字12と345、English、「かぎかっこ」。'.repeat(150) + '</p><ul><li>リスト</li></ul><blockquote><p>引用</p></blockquote><p>最後の一文ENDMARK。</p>';
      });
      for (const mode of ['vertical', 'horizontal']) {
        for (const [ch, label] of [[0, 'short'], [1, 'long']]) {
          await page.evaluate(async ([mode, ch]) => {
            localStorage.clear();
            const st = await import('/app/js/state.js'); const r = await import('/app/js/reader.js');
            document.querySelector('.reader')?.remove();
            const b = st.S.books.get('bk8'); b.writing = mode;
            r.openReader(b, { startChapter: ch });
          }, [mode, ch]);
          await page.waitForTimeout(450);
          const m = await page.evaluate(() => {
            const p = document.querySelector('.reading-paper'), r = p.getBoundingClientRect(), vw = innerWidth;
            return { left: r.left, right: vw - r.right, w: r.width, sw: p.scrollWidth, cw: p.clientWidth, sh: p.scrollHeight, ch: p.clientHeight };
          });
          if (vp.width > 600) assert(Math.abs(m.left - m.right) <= 2, `${mode}/${label}@${vp.width}: paper not centred ${JSON.stringify(m)}`);
          else assert(m.left <= 8 && m.right <= 8, `${mode}/${label}@${vp.width}: phone paper should use the width`);
          if (label === 'long') {
            // scroll to the very end and check the last sentence is visible inside the paper
            await page.evaluate((mode) => { const p = document.querySelector('.reading-paper'); if (mode === 'vertical') p.scrollLeft = -(p.scrollWidth); else p.scrollTop = p.scrollHeight; }, mode);
            await page.waitForTimeout(250);
            const vis = await page.evaluate(() => {
              const p = document.querySelector('.reading-paper').getBoundingClientRect();
              const w = document.createTreeWalker(document.querySelector('.reading-paper'), NodeFilter.SHOW_TEXT);
              let n; while ((n = w.nextNode())) if (n.nodeValue.includes('ENDMARK')) { const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1 && r.top >= p.top - 1 && r.bottom <= p.bottom + 1; }
              return false;
            });
            assert(vis, `${mode}@${vp.width}: end of long chapter not reachable`);
            const over = await page.evaluate(() => { const p = document.querySelector('.reading-paper').getBoundingClientRect(); return [...document.querySelectorAll('.reading-paper .chapter > *')].filter((e) => getComputedStyle(e).writingMode === 'horizontal-tb' && e.getBoundingClientRect().width > p.width + 1).length; });
            assert(over === 0, 'element wider than paper');
          }
          if (mode === 'vertical' && label === 'short' && vp.width >= 1024) await page.screenshot({ path: path.join(SHOTS, 'reader-short-vertical.png') });
          if (mode === 'vertical' && label === 'long' && vp.width === 390) await page.screenshot({ path: path.join(SHOTS, 'reader-long-vertical-phone.png') });
          res.push(`${mode[0]}/${label}@${vp.width}`);
        }
      }
      await ctx.close();
    }
    return res.length + ' cases';
  });

  await test('既存データ互換：新項目の無い旧形式の本をそのまま表示できる', async () => {
    const { ctx, page } = await newPage();
    await page.goto(BASE);
    await page.evaluate(async () => {
      const db = await import('/app/js/db.js');
      const shop = { key: 'shop', schema: 1, name: '旧データの本屋', tagline: '', owner: '旧店主', intro: '', profileUrl: '', avatarImageId: null, theme: 'luxury', featured: [], featuredPop: '', shelves: [{ id: 'unsorted', name: '未分類' }] };
      const art = { id: 'old1', title: '旧形式の記事', html: '<p>' + 'あ'.repeat(1200) + '</p>', status: 'publish', url: 'https://note.com/x/n/old1', images: [] };
      // book saved by the previous version: no forWhom field
      const book = { id: 'b_old', title: '旧形式の本', spineTitle: null, articleIds: ['old1'], kind: 'single', mode: 'post', writing: 'horizontal', shelfId: 'unsorted', order: 1, face: 'spine', hidden: false, mergedInto: null, seriesStatus: null, pop: '', popOnShelf: true, blurb: '', shareBody: false, design: { color: null, material: null, motif: null, coverPos: { x: 50, y: 50, s: 1 }, spineImageId: null, spinePos: { x: 50, y: 50, s: 1 }, showTitle: true, showAuthor: true, titleColor: null, titleAlign: 'top', titleWriting: 'horizontal', spineStyle: null } };
      await db.write({ put: { meta: [shop], articles: [art], books: [book] } });
    });
    await page.reload();
    await page.waitForSelector('.bay .book');
    await page.locator('.bay .book').first().click();
    const chips = await page.locator('.detail .meta').innerText();
    assert(chips.includes('約2分'), 'reading time for 1200 chars: ' + chips);
    assert(!(await page.locator('.detail .reco').count()), 'empty forWhom shown');
    await ctx.close();
    return chips.replace(/\n/g, ' ');
  });

  await test('縦書きの英数字・有料部分の境界（表示・公開用データから除外・バックアップで保持）', async () => {
    const { ctx, page } = await newPage({ width: 390, height: 844 });
    await page.goto(BASE);
    await page.getByText('サンプルの本屋を見る').click();
    await page.evaluate(async () => {
      const st = await import('/app/js/state.js'); const r = await import('/app/js/reader.js');
      st.S.articles.get('s8').html = '<p>2024年8月に300円、9月、AIとLINE、mofusandが2.8倍。かわいい!本当!?</p><p>無料の最後</p><p>ここから有料の本文PAIDTEXT</p>';
      const b = st.S.books.get('bk8'); b.writing = 'vertical'; b.paywall = { s8: { at: 2, text: 'ここから有料の本文PAIDTEXT' } };
      localStorage.clear(); r.openReader(b, { startChapter: 0 });
    });
    await page.waitForSelector('.reading-paper.vertical');
    const tc = await page.evaluate(() => ({ tcy: [...document.querySelectorAll('.reading-paper .tcy')].map((e) => e.textContent), upr: [...document.querySelectorAll('.reading-paper .upr')].map((e) => e.textContent) }));
    for (const x of ['8', '9', 'AI', '!?']) assert(tc.tcy.includes(x), 'tcy missing ' + x + JSON.stringify(tc));
    for (const x of ['2024', '300', 'LINE', '2.8', '!']) assert(tc.upr.includes(x), 'upright missing ' + x + JSON.stringify(tc));
    assert(![...tc.tcy, ...tc.upr].includes('mofusand'), 'english word should stay sideways');
    const markBefore = await page.evaluate(() => { const m = document.querySelector('.paywall-mark'); return m && m.nextElementSibling && m.nextElementSibling.textContent; });
    assert(markBefore && markBefore.includes('PAIDTEXT'), 'paywall marker position');
    // sideways option keeps text as-is
    await page.locator('.reader .tool[aria-label="表示の設定"]').click();
    await page.locator('.reader-pop button', { hasText: '横に寝かせる' }).click();
    assert((await page.locator('.reading-paper .upr').count()) === 0, 'sideways option');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    // public model: paid part removed, flagged
    const m = await page.evaluate(async () => {
      const s = await import('/app/js/share.js'); const st = await import('/app/js/state.js');
      for (const a of st.S.articles.values()) { a.status = 'publish'; a.url = 'https://note.com/x/n/' + a.id; }
      const model = s.buildPublicModel({ ids: new Set(['bk8']), bodyIds: new Set(['bk8']) });
      return JSON.stringify(model.books[0]);
    });
    assert(!m.includes('PAIDTEXT') && m.includes('"paidCut":true') && m.includes('無料の最後') && m.includes('"paidNote":true'), 'paid part in public data: ' + m.slice(0, 300));
    await ctx.close();
    return `tcy ${tc.tcy.join(',')} / upright ${tc.upr.join(',')}`;
  });

  // ---------- published ZIP ----------
  await test('公開用ZIP：静的配置で表示・画像あり・本文は許可した本のみ', async () => {
    const page = shop;
    const b64 = await page.evaluate(async () => {
      const share = await import('/app/js/share.js'); const st = await import('/app/js/state.js');
      const ids = new Set(st.S.books.keys());
      const body = new Set([[...st.S.books.values()].find((b) => !b.hidden && b.kind === 'serial').id]);
      const blob = await share.buildPublishZip(share.buildPublicModel({ ids, bodyIds: body, images: true }), { download: false });
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s);
    });
    const dir = path.join(OUT, 'published');
    fs.mkdirSync(dir, { recursive: true });
    const ff = await import(path.join(ROOT, 'app/vendor/fflate.js'));
    const files = ff.unzipSync(new Uint8Array(Buffer.from(b64, 'base64')));
    for (const [n, d] of Object.entries(files)) { const fp = path.join(dir, n); fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, Buffer.from(d)); }
    const data = fs.readFileSync(path.join(dir, 'data/shop.json'), 'utf8');
    assert(!/SECRET|UNKNOWN_STATUS/.test(data), 'leak');
    pubServer = spawn(process.execPath, [path.join(ROOT, 'tests/serve.mjs'), String(PUB_PORT), dir], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 500));
    const { ctx, page: v } = await newPage();
    await v.goto(`http://localhost:${PUB_PORT}/`);
    await v.waitForSelector('.bay .book');
    assert(!(await v.locator('.editbar').count()), 'editbar in published');
    const loaded = await v.locator('.book .book-art').first().evaluate((i) => new Promise((r) => (i.complete ? r(i.naturalWidth) : (i.onload = () => r(i.naturalWidth)))));
    assert(loaded > 0, 'image not loaded in published site');
    // body: serial readable, the single book not
    const readable = await v.evaluate(async () => { const st = await import('/app/js/state.js'); return [...st.S.books.values()].map((b) => [b.kind, b.shareBody]); });
    assert(readable.some(([k, s]) => k === 'serial' && s) && readable.every(([k, s]) => k === 'serial' || !s), JSON.stringify(readable));
    await v.screenshot({ path: path.join(SHOTS, 'published.png') });
    await ctx.close();
    return `${Object.keys(files).length} files`;
  });

  await test('プレビュー：編集ボタンが出ない／編集に戻れる', async () => {
    const page = shop;
    await page.locator('.editbar button', { hasText: 'プレビュー' }).click();
    await page.waitForSelector('.banner');
    await page.locator('.bay .book').first().click();
    assert(!(await page.locator('.editbar, .edit-tools').count()), 'edit UI in preview');
    await page.keyboard.press('Escape');
    await page.locator('.banner button', { hasText: '編集に戻る' }).click();
    await page.waitForSelector('.editbar');
    return 'ok';
  });

  await test('棚画像の書き出し（キャンバス描画）', async () => {
    const page = shop;
    const sizes = await page.evaluate(async () => {
      const share = await import('/app/js/share.js'); const st = await import('/app/js/state.js');
      const blobs = await share.paintShop({ shelfIds: st.S.shop.shelves.map((s) => s.id), featured: true, header: true });
      const out = [];
      for (const b of blobs) { const bmp = await createImageBitmap(b); out.push([bmp.width, bmp.height, b.size]); }
      const r = new FileReader(); const durl = await new Promise((res) => { r.onload = () => res(r.result); r.readAsDataURL(blobs[0]); });
      return { out, durl };
    });
    fs.writeFileSync(path.join(SHOTS, 'shelf-export.jpg'), Buffer.from(sizes.durl.split(',')[1], 'base64'));
    assert(sizes.out.length >= 1 && sizes.out[0][0] === 1500, JSON.stringify(sizes.out));
    return JSON.stringify(sizes.out);
  });

  // ---------- real export (optional, never committed) ----------
  if (process.env.NOTE_EXPORT_ZIP) {
    await test('実データ：noteエクスポートZIPの取込', async () => {
      const { ctx, page } = await newPage();
      await page.goto(BASE);
      const r = await importFile(page, process.env.NOTE_EXPORT_ZIP, { suggestions: 'accept', theme: 'warm' });
      const st = await S(page, (st) => ({ arts: st.S.articles.size, books: [...st.S.books.values()].filter((b) => !b.hidden).length, serial: [...st.S.books.values()].filter((b) => b.kind === 'serial').length, head: [...st.S.articles.values()].filter((a) => a.headImageId).length, drafts: [...st.S.articles.values()].filter((a) => a.status === 'draft').length, urls: [...st.S.articles.values()].filter((a) => a.url).length }));
      await page.screenshot({ path: path.join(SHOTS, 'real.png'), fullPage: true });
      await ctx.close();
      return `${r.summary} → ${JSON.stringify(st)}`;
    });
  }

  await browser.close();
  server.kill(); if (pubServer) pubServer.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. screenshots: ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); if (server) server.kill(); if (pubServer) pubServer.kill(); process.exit(1); });
