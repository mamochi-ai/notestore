// Reading-time estimate. The ONLY place the reading speed is defined.
// 日本語の黙読速度はおおむね400〜600字/分と言われるため、その中間の500字/分を目安に使う。
// 表示は「約○分」で、10分を超えたら5分単位に丸めて、精密に見せない。
export const CHARS_PER_MINUTE = 500;

const cache = new Map(); // article id + html length -> char count

/** Visible characters of sanitized article HTML (tags, whitespace and image placeholders excluded). */
export function textChars(article) {
  if (!article || typeof article.html !== 'string' || !article.html) return 0;
  const key = `${article.id}:${article.html.length}:${article.contentHash || ''}`;
  if (cache.has(key)) return cache.get(key);
  const t = document.createElement('template');
  t.innerHTML = article.html;
  for (const el of t.content.querySelectorAll('figcaption, rt, rp')) el.remove();
  const n = (t.content.textContent || '').replace(/\s+/g, '').length;
  cache.set(key, n);
  return n;
}

export function minutesFor(chars) {
  if (!chars) return 0;
  const m = Math.max(1, Math.round(chars / CHARS_PER_MINUTE));
  return m > 10 ? Math.round(m / 5) * 5 : m;
}
export const formatMinutes = (m) => (m ? `約${m}分` : '');

/** {total, chapters:[minutes|0]} — only from chapters that actually have body text. */
export function bookReadingTime(articles) {
  const chars = articles.map(textChars);
  const sum = chars.reduce((a, b) => a + b, 0);
  return { total: minutesFor(sum), chapters: chars.map(minutesFor) };
}
