// ============================================================
// IndexedDB typed storage layer (v8.7 localStorage replaced).
// Same keys preserved for migration: atlas_v84_standard_params, etc.
// ============================================================
const DB_NAME = 'atlas_v9';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await open();
  return new Promise((res) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => res((r.result as T) ?? null);
    r.onerror = () => res(null);
  });
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function idbClear(): Promise<void> {
  const db = await open();
  return new Promise((res) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => res();
  });
}

// Storage keys (v8.7 names preserved for seamless migration)
export const KEYS = {
  standardParams: 'atlas_v84_standard_params',
  jackpotParams: 'atlas_v84_jackpot_params',
  predictions: 'atlas_v8_learning',
  session: 'atlas_v8_session',
} as const;
