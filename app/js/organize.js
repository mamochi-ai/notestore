// Rule-based helpers (no AI): series candidates from titles, shelf candidates from 【tags】.
// Results are only suggestions; the owner confirms everything.

const NUM = /(?:vol\.?|ｖｏｌ．?|#|＃|no\.?|part|第|その|ep\.?)\s*([0-9０-９]+|[一二三四五六七八九十百]+)\s*(?:話|回|章|部|弾)?/i;
const KANJI = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function toNum(s) {
  if (!s) return null;
  const z = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (/^\d+$/.test(z)) return parseInt(z, 10);
  let n = 0, cur = 0;
  for (const ch of z) {
    if (ch === '十') { n += (cur || 1) * 10; cur = 0; }
    else if (ch === '百') { n += (cur || 1) * 100; cur = 0; }
    else cur = KANJI[ch] || 0;
  }
  return n + cur || null;
}

export function normalizeTag(t) {
  return t.replace(/[✖✕✗xX×]️?/g, '×').replace(/\s+/g, '').trim();
}
export function leadingTags(title) {
  const tags = [];
  let t = (title || '').replace(/^[\s\p{Extended_Pictographic}️‍]+/u, '');
  for (let i = 0; i < 3; i++) {
    const m = /^[【［\[]([^】］\]]{1,24})[】］\]]\s*/.exec(t);
    if (!m) break;
    tags.push(normalizeTag(m[1]));
    t = t.slice(m[0].length).replace(/^[\s\p{Extended_Pictographic}️‍]+/u, '');
  }
  return { tags, rest: t };
}

/** Title stem used to group series: tags/emoji/numbering/subtitles removed. */
export function seriesStem(title) {
  let { rest } = leadingTags(title);
  const m = NUM.exec(rest);
  const num = m ? toNum(m[1]) : null;
  let stem = m ? rest.slice(0, m.index) : rest;
  stem = stem.replace(/[（(][^）)]*[）)]/g, '').replace(/[〜～].*$/, '').replace(/[\s\p{Extended_Pictographic}️‍・:：\-–—|｜]+$/u, '').replace(/\s+/g, '');
  return { stem, num };
}

/**
 * books: single-article books. Returns [{stem, title, books:[...] ordered}] with ≥2 members.
 */
export function suggestSeries(books, articleOf) {
  const groups = new Map();
  for (const b of books) {
    if (b.kind !== 'single' || b.hidden) continue;
    const a = articleOf(b);
    const { stem, num } = seriesStem(a ? a.title : b.title);
    if (num == null || stem.length < 4) continue;
    if (!groups.has(stem)) groups.set(stem, []);
    groups.get(stem).push({ b, num, date: a && a.date });
  }
  const out = [];
  for (const [stem, list] of groups) {
    if (list.length < 2) continue;
    list.sort((x, y) => (x.num - y.num) || String(x.date).localeCompare(String(y.date)));
    out.push({ stem, title: stem, books: list.map((x) => x.b) });
  }
  return out;
}

/** Shelf candidates from leading 【tags】 shared by ≥2 books. */
export function suggestShelves(books, articleOf) {
  const map = new Map();
  for (const b of books) {
    if (b.hidden) continue;
    const a = articleOf(b);
    const { tags } = leadingTags(a ? a.title : b.title);
    for (const t of tags.slice(0, 1)) {
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(b);
    }
  }
  return [...map.entries()].filter(([, l]) => l.length >= 2).map(([name, list]) => ({ name, books: list }))
    .sort((a, b) => b.books.length - a.books.length);
}

/** Keyword assist: unsorted books whose title contains any keyword. */
export function matchKeywords(title, keywords) {
  const t = (title || '').toLowerCase();
  return keywords.some((k) => k && t.includes(k.toLowerCase()));
}
