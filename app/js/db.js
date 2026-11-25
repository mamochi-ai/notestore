// IndexedDB storage. Every write resolves only after the transaction commits,
// so "saved" is never reported before the data is actually stored.

const DB_NAME = 'little-bookshop';
const DB_VERSION = 1;
export const STORES = ['meta', 'articles', 'books', 'images'];

let dbPromise = null;

export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
    this.quota = !!(cause && (cause.name === 'QuotaExceededError' || /quota/i.test(cause.message || '')));
  }
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new StorageError('この環境では端末保存（IndexedDB）が使えません。')); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { reject(new StorageError('端末保存を開けませんでした（プライベートブラウズ中の可能性があります）。', e)); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(new StorageError('端末保存を開けませんでした。', req.error));
    req.onblocked = () => reject(new StorageError('別のタブがデータベースを使用中です。他のタブを閉じてください。'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new StorageError(tx.error && tx.error.name === 'QuotaExceededError'
      ? '端末の保存容量が足りません。画像を減らすか、不要な本を削除してください。'
      : '保存に失敗しました。', tx.error));
    tx.onabort = () => reject(new StorageError(tx.error && tx.error.name === 'QuotaExceededError'
      ? '端末の保存容量が足りません。画像を減らすか、不要な本を削除してください。'
      : '保存が中断されました。', tx.error));
  });
}

export async function getAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(new StorageError('読み込みに失敗しました。', req.error));
  });
}

export async function get(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new StorageError('読み込みに失敗しました。', req.error));
  });
}

/**
 * Batched write. ops: { put: {store: [records]}, del: {store: [keys]}, clear: [stores] }
 * One transaction → all-or-nothing.
 */
export async function write(ops) {
  const db = await openDB();
  const stores = new Set([...Object.keys(ops.put || {}), ...Object.keys(ops.del || {}), ...(ops.clear || [])]);
  if (!stores.size) return;
  let tx;
  try { tx = db.transaction([...stores], 'readwrite'); }
  catch (e) { throw new StorageError('保存を開始できませんでした。', e); }
  const done = txDone(tx);
  try {
    for (const s of ops.clear || []) tx.objectStore(s).clear();
    for (const [s, recs] of Object.entries(ops.put || {})) for (const r of recs) tx.objectStore(s).put(r);
    for (const [s, keys] of Object.entries(ops.del || {})) for (const k of keys) tx.objectStore(s).delete(k);
  } catch (e) {
    try { tx.abort(); } catch { /* already aborted */ }
    await done.catch(() => {});
    throw new StorageError(e && e.name === 'DataCloneError' ? '保存できない形式のデータが含まれています。' : '保存に失敗しました。', e);
  }
  await done;
}

export async function storageInfo() {
  const out = { persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      out.usage = e.usage; out.quota = e.quota;
    }
  } catch { /* not supported */ }
  return out;
}

export async function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); }
  catch { /* ignore */ }
  return false;
}
