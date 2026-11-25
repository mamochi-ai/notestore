// Allow-list HTML sanitizer. Imported article HTML is never executed:
// it is parsed in an inert DOMParser document (no scripts, no resource loading)
// and rebuilt from scratch with only safe tags/attributes.

import { safeHttpUrl } from './util.js';

const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button',
  'select', 'textarea', 'option', 'link', 'meta', 'base', 'svg', 'math', 'template', 'noscript', 'video', 'audio', 'source',
  'track', 'canvas', 'title', 'head', 'portal', 'dialog', 'slot', 'xmp', 'plaintext', 'noembed', 'noframes', 'param', 'map', 'area']);
const MAP = { b: 'strong', i: 'em', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3', del: 's', strike: 's', rb: null };
const KEEP = new Set(['p', 'br', 'hr', 'h2', 'h3', 'strong', 'em', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'figure', 'figcaption',
  'img', 'a', 'pre', 'code', 'ruby', 'rt', 'rp', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'sup', 'sub', 'small', 'mark']);

const MAX_NODES = 60000;
const MAX_DEPTH = 48;

/**
 * @param {string} html
 * @param {object} opt
 *   resolveImage(ref) -> imageId|null   (local images from the export)
 *   trusted: false  (data-img ids are re-validated against `knownImage` when given)
 * @returns {{html:string, images:Array<{ref:string, external:boolean}>, text:string}}
 */
export function sanitizeHtml(html, opt = {}) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html || ''}</body>`, 'text/html');
  const out = document.implementation.createHTMLDocument('');
  const root = out.createElement('div');
  const images = [];
  let count = 0;

  function walk(src, dst, depth) {
    for (const node of Array.from(src.childNodes)) {
      if (++count > MAX_NODES) return;
      if (node.nodeType === 3) { dst.appendChild(out.createTextNode(node.nodeValue)); continue; }
      if (node.nodeType !== 1) continue; // comments, PIs
      let tag = node.localName.toLowerCase();
      if (DROP.has(tag)) continue;
      if (tag in MAP) tag = MAP[tag];
      if (!tag || !KEEP.has(tag) || depth > MAX_DEPTH) { walk(node, dst, depth + 1); continue; } // unwrap unknown
      let el;
      if (tag === 'a') {
        const href = safeHttpUrl(node.getAttribute('href') || '');
        if (!href) { walk(node, dst, depth + 1); continue; }
        el = out.createElement('a');
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer nofollow');
      } else if (tag === 'img') {
        el = imgNode(node);
        if (!el) continue;
      } else {
        el = out.createElement(tag);
        if ((tag === 'td' || tag === 'th')) {
          for (const a of ['colspan', 'rowspan']) {
            const v = parseInt(node.getAttribute(a) || '', 10);
            if (v > 1 && v < 50) el.setAttribute(a, String(v));
          }
        }
      }
      dst.appendChild(el);
      if (tag !== 'img' && tag !== 'br' && tag !== 'hr') walk(node, el, depth + 1);
    }
  }

  function imgNode(node) {
    const alt = (node.getAttribute('alt') || '').slice(0, 300);
    const el = out.createElement('img');
    if (alt) el.setAttribute('alt', alt);
    // already-resolved local image (from our own storage / share data)
    const known = node.getAttribute('data-img');
    if (known && /^[a-z0-9_]{3,64}$/i.test(known) && (!opt.knownImage || opt.knownImage(known))) {
      el.setAttribute('data-img', known);
      return el;
    }
    const src = (node.getAttribute('src') || node.getAttribute('data-src') || '').trim();
    if (!src || /^data:/i.test(src) || /^(javascript|vbscript|blob|file):/i.test(src)) {
      const ext0 = node.getAttribute('data-ext');
      if (ext0 && safeHttpUrl(ext0)) { el.setAttribute('data-ext', safeHttpUrl(ext0)); return el; }
      return null;
    }
    if (/^https?:\/\//i.test(src) || src.startsWith('//')) {
      const u = safeHttpUrl(src.startsWith('//') ? 'https:' + src : src);
      if (!u) return null;
      // never auto-load external images: keep the URL only as data
      el.setAttribute('data-ext', u);
      images.push({ ref: u, external: true });
      return el;
    }
    images.push({ ref: src, external: false });
    const id = opt.resolveImage ? opt.resolveImage(src) : null;
    if (id) el.setAttribute('data-img', id);
    else el.setAttribute('data-missing', src.slice(0, 300));
    return el;
  }

  walk(doc.body, root, 0);
  // drop empty paragraphs at the very start (note exports often start with <p><br></p>)
  while (root.firstChild && root.firstChild.nodeName === 'P' && !root.firstChild.textContent.trim() && !root.firstChild.querySelector('img')) root.firstChild.remove();
  return { html: root.innerHTML, images, text: root.textContent || '' };
}

/** Plain text excerpt. */
export function excerpt(text, n = 120) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}
