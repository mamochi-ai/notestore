// Reader: horizontal or vertical (vertical-rl) per chapter. Vertical text scrolls horizontally
// chapter by chapter (no page splitting), so font size / rotation never drops or duplicates text.
import { h, debounce, toast, $, $$ } from './util.js';
import { icon, trapTab } from './ui.js';
import { S, bookArticles, bookUrl, imageUrl } from './state.js';

const PREF_KEY = 'bookshop:reader';
function prefs() {
  try { return { fs: 18, lh: 1.95, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { fs: 18, lh: 1.95 }; }
}
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify({ fs: p.fs, lh: p.lh })); } catch { /* private mode */ } }
const posKey = (b) => `bookshop:pos:${S.source}:${b.id}`;
const markKey = (b) => `bookshop:mark:${S.source}:${b.id}`;
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export function openReader(book, { startChapter = null, startArticleId = null } = {}) {
  const arts = bookArticles(book).filter((a) => a.html != null);
  if (!arts.length) { toast('この本は本文を読めません'); return; }
  const prevFocus = document.activeElement;
  const p = prefs();
  const st = {
    ch: 0, writing: book.writing === 'vertical' ? 'vertical' : 'horizontal', media: true,
    fs: p.fs, lh: p.lh,
  };
  const last = lsGet(posKey(book));
  if (startArticleId != null) { const i = arts.findIndex((a) => a.id === startArticleId); if (i >= 0) startChapter = i; }
  // a chapter chosen explicitly (e.g. from the table of contents) always opens at its beginning,
  // independent of the saved reading position
  const explicit = startChapter != null && startChapter >= 0 && startChapter < arts.length;
  if (explicit) st.ch = startChapter;
  else if (last && last.ch < arts.length) st.ch = last.ch;
  if (last && last.writing) st.writing = last.writing;

  const title = h('div', { class: 'ttl', id: 'reader-title' });
  const paper = h('article', { class: 'reading-paper', tabindex: '0', 'aria-labelledby': 'reader-title' });
  const stage = h('div', { class: 'reader-stage' }, paper);
  const progress = h('span', { class: 'progress-text', 'aria-live': 'polite' });
  const multi = arts.length > 1;
  const prevBtn = h('button', { type: 'button', class: 'btn nav' }, icon('left'), '前の章');
  const nextBtn = h('button', { type: 'button', class: 'btn nav' }, '次の章', icon('right'));
  let pop = null;
  const tool = (iconName, label, aria) => h('button', { type: 'button', class: 'tool', 'aria-label': aria || label }, icon(iconName), h('span', { class: 'tool-label', 'aria-hidden': 'true' }, label));
  const closeBtn = h('button', { type: 'button', class: 'btn back' }, icon('left'), '棚へ戻る');
  const tocBtn = tool('list', '目次');
  tocBtn.setAttribute('aria-haspopup', 'true');
  const setBtn = tool('text', '表示', '表示の設定');
  setBtn.setAttribute('aria-haspopup', 'true');
  const markBtn = tool('bookmark', 'しおり', 'しおりを挟む');
  const el = h('div', { class: 'reader', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${book.title}を読む` },
    h('div', { class: 'reader-top' }, closeBtn, title, h('div', { class: 'tools' }, tocBtn, setBtn, markBtn)),
    stage,
    h('div', { class: `reader-bottom${multi ? '' : ' single'}` }, multi ? prevBtn : h('span'), progress, multi ? nextBtn : h('span')));
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';

  function ratio() {
    if (st.writing === 'vertical') {
      const max = paper.scrollWidth - paper.clientWidth;
      return max > 0 ? Math.min(1, Math.abs(paper.scrollLeft) / max) : 0;
    }
    const max = paper.scrollHeight - paper.clientHeight;
    return max > 0 ? Math.min(1, paper.scrollTop / max) : 0;
  }
  function setRatio(r) {
    if (st.writing === 'vertical') {
      const max = paper.scrollWidth - paper.clientWidth;
      // vertical-rl: start is at the right; modern engines use negative scrollLeft
      paper.scrollLeft = 0;
      const neg = (() => { paper.scrollLeft = -1; const v = paper.scrollLeft < 0; paper.scrollLeft = 0; return v; })();
      paper.scrollLeft = neg ? -r * max : r * max;
    } else {
      paper.scrollTop = r * (paper.scrollHeight - paper.clientHeight);
    }
  }
  const savePos = debounce(() => { lsSet(posKey(book), { ch: st.ch, r: ratio(), writing: st.writing }); updateProgress(); }, 250);
  paper.addEventListener('scroll', savePos, { passive: true });

  function updateProgress() {
    const scrollable = st.writing === 'vertical' ? paper.scrollWidth > paper.clientWidth + 2 : paper.scrollHeight > paper.clientHeight + 2;
    const chap = arts.length > 1 ? `${st.ch + 1} / ${arts.length}章` : '';
    progress.textContent = scrollable ? `${chap ? chap + '・' : ''}${Math.round(ratio() * 100)}%` : chap;
  }

  function render(restore = null) {
    paper.className = `reading-paper ${st.writing}${st.media ? '' : ' no-media'}`;
    paper.style.setProperty('--fs', st.fs + 'px');
    paper.style.setProperty('--lh', String(st.lh));
    const a = arts[st.ch];
    title.textContent = arts.length > 1 ? `${book.title}　${st.ch + 1}. ${a.title || ''}` : book.title;
    const chapter = h('div', { class: 'chapter' });
    chapter.appendChild(h('h1', { class: 'ch-title' }, arts.length > 1 ? (a.title || `第${st.ch + 1}章`) : (book.title || a.title)));
    chapter.appendChild(buildBody(a.html));
    const end = h('div', { class: 'chapter-end' });
    if (st.ch < arts.length - 1) end.appendChild(h('button', { type: 'button', class: 'btn primary', onclick: () => go(1) }, '次の章へ', icon('right')));
    else end.appendChild(h('span', null, '— おわり —'));
    const url = a.url || (st.ch === 0 ? bookUrl(book) : null);
    if (url) end.appendChild(h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'noteで読む', icon('ext')));
    chapter.appendChild(end);
    if (st.writing === 'vertical') applyTcy(chapter);
    paper.replaceChildren(chapter);
    prevBtn.disabled = st.ch === 0;
    nextBtn.disabled = st.ch >= arts.length - 1;
    fitPaper();
    requestAnimationFrame(() => { setRatio(restore || 0); updateProgress(); });
  }

  /**
   * Size the paper. Horizontal: a fixed comfortable measure (CSS). Vertical: the paper is as wide as
   * its text (so short chapters sit on a page in the middle, not at the screen edge), up to a maximum;
   * longer text scrolls inside the paper from right to left.
   */
  function fitPaper() {
    paper.style.width = '';
    if (st.writing !== 'vertical') return;
    const avail = stage.clientWidth - parseFloat(getComputedStyle(stage).paddingLeft) * 2;
    const maxW = Math.min(avail, 1120);
    const minW = Math.min(avail, avail < 600 ? avail : 560);
    paper.style.width = maxW + 'px';
    const cs = getComputedStyle(paper);
    const chapter = paper.firstElementChild;
    const need = (chapter ? chapter.getBoundingClientRect().width : 0) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 4;
    paper.style.width = Math.max(minW, Math.min(maxW, need)) + 'px';
  }

  function buildBody(html) {
    const t = document.createElement('template');
    t.innerHTML = html || ''; // already sanitized at import / load time
    for (const img of $$('img', t.content)) {
      const id = img.getAttribute('data-img');
      const url = id ? imageUrl(id) : null;
      if (url) { img.src = url; img.loading = 'lazy'; img.decoding = 'async'; continue; }
      const ext = img.getAttribute('data-ext');
      let ph;
      if (ext) ph = h('span', { class: 'img-missing' }, '外部の画像（自動では読み込みません）', h('br'), h('a', { href: ext, target: '_blank', rel: 'noopener noreferrer nofollow' }, '画像を開く'));
      else ph = h('span', { class: 'img-missing' }, id ? '画像は共有されていません' : '画像は取り込まれていません');
      img.replaceWith(ph);
    }
    // paragraphs that only contain <br> (note uses them as spacing) → compact
    for (const p of $$('p', t.content)) if (!p.textContent.trim() && !p.querySelector('img,span')) p.classList.add('blank');
    return t.content;
  }

  function go(d) {
    const n = st.ch + d;
    if (n < 0 || n >= arts.length) return;
    st.ch = n; render(0); lsSet(posKey(book), { ch: st.ch, r: 0, writing: st.writing });
    paper.focus({ preventScroll: true });
  }
  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));

  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function openPop(content, label) {
    closePop();
    pop = h('div', { class: 'reader-pop', role: 'dialog', 'aria-label': label }, content);
    stage.appendChild(pop);
    const f = pop.querySelector('button, input');
    if (f) f.focus();
  }
  tocBtn.addEventListener('click', () => {
    if (pop) { closePop(); return; }
    const mark = lsGet(markKey(book));
    openPop(h('div', null, h('h3', null, '目次'),
      mark && mark.ch < arts.length ? h('button', { type: 'button', class: 'btn small', style: 'margin-bottom:8px', onclick: () => { closePop(); st.ch = mark.ch; render(mark.r || 0); } }, icon('bookmark'), `しおりの位置へ（${multi ? `${mark.ch + 1}章・` : ''}${Math.round((mark.r || 0) * 100)}%）`) : null,
      h('div', { class: 'toc' }, arts.map((a, i) => h('button', { type: 'button', 'aria-current': String(i === st.ch), onclick: () => { closePop(); st.ch = i; render(0); lsSet(posKey(book), { ch: i, r: 0, writing: st.writing }); } }, `${i + 1}. ${a.title || '無題'}`)))), '目次');
  });
  setBtn.addEventListener('click', () => {
    if (pop) { closePop(); return; }
    const seg = (opts, get, set) => h('div', { class: 'seg', role: 'group' }, ...opts.map(([v, l]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(get() === v) }, l);
      b.addEventListener('click', () => { const r = ratio(); set(v); $$('button', b.parentNode).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(r); savePrefs(st); savePos(); });
      return b;
    }));
    openPop(h('div', null,
      h('h3', null, '書字方向'), seg([['vertical', '縦書き'], ['horizontal', '横書き']], () => st.writing, (v) => { st.writing = v; }),
      h('h3', null, '文字の大きさ'), seg([[15, '小'], [18, '中'], [21, '大'], [25, '特大']], () => st.fs, (v) => { st.fs = v; }),
      h('h3', null, '行間'), seg([[1.7, '狭い'], [1.95, 'ふつう'], [2.3, '広い']], () => st.lh, (v) => { st.lh = v; }),
      st.writing === 'vertical' ? h('div', null, h('h3', null, '縦書きの画像・表'), seg([[true, '表示する'], [false, '隠す']], () => st.media, (v) => { st.media = v; }), h('p', { class: 'hint' }, '画像や表が多い記事は、横書きにすると読みやすくなります。')) : null), '表示の設定');
  });
  markBtn.addEventListener('click', () => {
    const ok = lsSet(markKey(book), { ch: st.ch, r: ratio(), at: Date.now() });
    markBtn.classList.toggle('on', ok);
    toast(ok ? 'しおりを挟みました（この端末に保存）' : 'しおりを保存できませんでした');
  });
  const mark = lsGet(markKey(book));
  if (mark && !explicit && !last) { st.ch = Math.min(mark.ch, arts.length - 1); }

  function close() {
    savePos.flush && savePos.flush();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    document.body.style.overflow = '';
    if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch { /* */ }
  }
  closeBtn.addEventListener('click', close);
  let lastR = 0;
  paper.addEventListener('scroll', () => { lastR = ratio(); }, { passive: true });
  const onResize = debounce(() => { const r = lastR; fitPaper(); requestAnimationFrame(() => setRatio(r)); }, 150);
  window.addEventListener('resize', onResize);
  function onKey(e) {
    if (!el.isConnected) return;
    if (e.key === 'Escape') { e.preventDefault(); if (pop) closePop(); else close(); return; }
    if (e.key === 'Tab') { trapTab(e, el); return; }
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    if (st.writing === 'vertical' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === 'PageUp' || e.key === ' ')) {
      const fwd = e.key === 'ArrowLeft' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey);
      paper.scrollBy({ left: (fwd ? -1 : 1) * paper.clientWidth * 0.85, behavior: 'smooth' });
      e.preventDefault();
    }
  }
  document.addEventListener('keydown', onKey, true);
  // mouse wheel → horizontal scrolling in vertical mode
  paper.addEventListener('wheel', (e) => {
    if (st.writing !== 'vertical' || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    paper.scrollLeft -= e.deltaY;
    e.preventDefault();
  }, { passive: false });

  const resume = !explicit && last && last.ch === st.ch;
  render(explicit ? 0 : resume ? last.r : mark && !last ? mark.r : 0);
  if (resume && (last.ch || last.r > 0.02)) toast('前回の続きから表示しています');
  requestAnimationFrame(() => closeBtn.focus());
  return { close, el, state: st, setRatio, ratio };
}

/** Wrap 1–2 digit numbers (and !? pairs) for tate-chu-yoko in vertical text. */
function applyTcy(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest('figure,table,pre,code,a,.h-island,rt') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const re = /(?<![0-9A-Za-z.,])([0-9]{1,2}|[!?！？]{2})(?![0-9A-Za-z.,])/g;
  for (const n of nodes) {
    const s = n.nodeValue;
    if (!re.test(s)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      frag.appendChild(h('span', { class: 'tcy' }, m[1]));
      last = m.index + m[0].length;
    }
    frag.appendChild(document.createTextNode(s.slice(last)));
    n.replaceWith(frag);
  }
}
