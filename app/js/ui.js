import { h, svg, $$ } from './util.js';

const ICONS = {
  book: 'M3 6.5C5.5 5 8.5 5 12 6.8 15.5 5 18.5 5 21 6.5V19c-2.5-1.4-5.5-1.4-9 .4-3.5-1.8-6.5-1.8-9-.4Z M12 6.8V19.4',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Z M13.5 6.5l4 4',
  share: 'M17 7a2.5 2.5 0 1 0 0-.01Z M7 12a2.5 2.5 0 1 0 0-.01Z M17 17a2.5 2.5 0 1 0 0-.01Z M9.2 10.8l5.6-2.8 M9.2 13.2l5.6 2.8',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z M15.5 15.5 20 20',
  close: 'M6 6l12 12M18 6 6 18',
  ext: 'M14 4h6v6 M20 4l-9 9 M18 14v5H5V6h5',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 16v4h16v-4',
  download: 'M12 4v12 M7 11l5 5 5-5 M4 16v4h16v-4',
  palette: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.5-4-8-9-8Z M7.5 11.5h.01 M9.5 7.5h.01 M14.5 7.5h.01',
  shelves: 'M4 4v16 M20 4v16 M4 9h16 M4 15h16 M7 9V5 M9.5 9V6 M12 15v-4 M14.5 15v-3',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-.9a7 7 0 0 0 2 1.2L10 21h4l.5-2.5a7 7 0 0 0 2-1.2l2.4.9 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  list: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  text: 'M4 7V5h11v2 M9.5 5v14 M7 19h5 M14 12V11h6v1 M17 11v8 M15.5 19h3',
  bookmark: 'M6 3h12v18l-6-4-6 4Z',
  layers: 'M12 3 2 8l10 5 10-5Z M2 13l10 5 10-5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21c1-4 4-6 8-6s7 2 8 6',
  up: 'M12 19V5 M5 12l7-7 7 7',
  down: 'M12 5v14 M5 12l7 7 7-7',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  image: 'M4 5h16v14H4Z M4 16l5-5 4 4 3-3 4 4 M15 9.5h.01',
  check: 'M5 12l5 5 9-10',
};

export function icon(name, cls = '') {
  return svg('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: ICONS[name] || '', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}

export function logo(cls = 'logo') {
  return svg('svg', { viewBox: '0 0 48 36', class: cls, 'aria-hidden': 'true' },
    svg('path', { d: 'M3 7c7-4 14-4 21 1 7-5 14-5 21-1v24c-7-3-14-3-21 1-7-4-14-4-21-1Z M24 8v24 M3 7v24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linejoin': 'round' }));
}

export function btn(label, onClick, { cls = '', iconName = null, attrs = {} } = {}) {
  return h('button', { type: 'button', class: `btn ${cls}`, onclick: onClick, ...attrs }, iconName ? icon(iconName) : null, label);
}

// ---------- modal ----------
const openStack = [];

export function openModal({ title, body, actions = [], wide = false, onClose, label }) {
  const prevFocus = document.activeElement;
  const titleId = 'mt_' + Math.random().toString(36).slice(2);
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '閉じる' }, icon('close'));
  const footer = actions.length ? h('footer', null) : null;
  const modal = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('header', null, h('h2', { id: titleId }, title), closeBtn),
    h('div', { class: 'body' }, body),
    footer);
  const backdrop = h('div', { class: 'modal-backdrop' }, modal);
  let closed = false;
  const api = {
    el: modal, body: modal.querySelector('.body'),
    close(result) {
      if (closed) return;
      closed = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      openStack.splice(openStack.indexOf(api), 1);
      if (!openStack.length) document.body.style.overflow = '';
      if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch { /* gone */ }
      onClose && onClose(result);
    },
    setActions(list) { renderActions(list); },
  };
  function renderActions(list) {
    if (!footer) return;
    footer.replaceChildren(...list.map((a) => {
      const b = h('button', { type: 'button', class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''} ${a.cls || ''}`, disabled: a.disabled || null }, a.label);
      b.addEventListener('click', async () => {
        if (a.onClick) {
          const r = await a.onClick(api);
          if (r === false) return;
        }
        if (a.close !== false) api.close(a.value);
      });
      return b;
    }));
  }
  renderActions(actions);
  closeBtn.addEventListener('click', () => api.close());
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) api.close(); });
  function onKey(e) {
    if (openStack[openStack.length - 1] !== api) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(); }
    if (e.key === 'Tab') trapTab(e, modal);
  }
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  openStack.push(api);
  requestAnimationFrame(() => {
    const first = modal.querySelector('.body [autofocus], .body input, .body select, .body textarea, .body button') || closeBtn;
    try { first.focus({ preventScroll: true }); } catch { /* */ }
  });
  return api;
}

export function trapTab(e, root) {
  const f = $$('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])', root)
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function anyModalOpen() { return openStack.length > 0; }

export function confirmDialog(message, { title = '確認', ok = 'OK', cancel = 'キャンセル', danger = false } = {}) {
  return new Promise((resolve) => {
    const body = h('div', null, ...String(message).split('\n').map((l) => h('p', { style: 'margin:0 0 .6em;line-height:1.8' }, l)));
    openModal({
      title, body,
      actions: [
        { label: cancel, value: false },
        { label: ok, primary: !danger, danger, value: true },
      ],
      onClose: (v) => resolve(!!v),
    });
  });
}

export function alertDialog(message, title = 'お知らせ') {
  return new Promise((resolve) => {
    const body = h('div', null, ...String(message).split('\n').map((l) => h('p', { style: 'margin:0 0 .6em;line-height:1.8' }, l)));
    openModal({ title, body, actions: [{ label: 'OK', primary: true }], onClose: () => resolve() });
  });
}

/** Progress dialog with cancel. */
export function progressDialog(title) {
  let cancelled = false;
  let closing = false;
  const bar = h('div');
  const text = h('p', { class: 'hint', 'aria-live': 'polite' }, '準備しています…');
  const m = openModal({
    title,
    body: h('div', null, h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar), text),
    actions: [{ label: 'キャンセル', onClick: () => { cancelled = true; text.textContent = 'キャンセルしています…'; return false; } }],
    onClose: () => { if (!closing) cancelled = true; },
  });
  return {
    set(frac, msg) {
      const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
      bar.style.width = pct + '%';
      bar.parentElement.setAttribute('aria-valuenow', String(pct));
      if (msg) text.textContent = msg;
    },
    get cancelled() { return cancelled; },
    close() { closing = true; m.close(); },
  };
}

export class Cancelled extends Error { constructor() { super('キャンセルしました'); this.name = 'Cancelled'; } }
