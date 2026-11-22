// Paid-section boundary. note's export does NOT contain where the paid part starts (verified on a real
// export), so the owner marks it by hand: "this block and everything after it is paid".
// Stored on the BOOK (book.paywall[articleId] = {at, text}) so re-importing an article never loses it.
// `text` (start of the block) re-locates the boundary if paragraphs shift after an update.

export const PAID_HINT = /(有料|この先|ここから先|続きは|購入|メンバーシップ|マガジン限定)/;

function blocks(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '';
  return { root: t.content, list: [...t.content.children] };
}
const snippet = (el) => (el.tagName === 'FIGURE' && !el.textContent.trim() ? '［画像］' : (el.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 40);

/** Top-level blocks for the picker: [{i, text, hint}] */
export function listBlocks(html) {
  return blocks(html).list.map((el, i) => ({ i, text: snippet(el) || '（空の段落）', hint: PAID_HINT.test(el.textContent || '') }));
}

/** Index of the first paid block, or -1. */
export function locate(html, mark) {
  if (!mark || !Number.isInteger(mark.at)) return -1;
  const list = blocks(html).list;
  if (mark.text) {
    const exact = list.findIndex((el) => snippet(el) === mark.text);
    if (exact >= 0) return exact;
  }
  return mark.at >= 0 && mark.at < list.length ? mark.at : -1;
}

/** Split sanitized html at the boundary → {free, paid, cut} */
export function splitHtml(html, mark) {
  const at = locate(html, mark);
  if (at < 0) return { free: html, paid: '', cut: false };
  const { list } = blocks(html);
  const box = document.createElement('div');
  const free = list.slice(0, at).map((e) => e.outerHTML).join('');
  const paid = list.slice(at).map((e) => e.outerHTML).join('');
  box.remove();
  return { free, paid, cut: true };
}

export const markFor = (book, articleId) => (book && book.paywall && book.paywall[articleId]) || null;
export const hasPaid = (book) => !!(book && book.paywall && Object.keys(book.paywall).length);
