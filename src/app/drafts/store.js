// Draft persistence, separate from the diary: its own IndexedDB database,
// so drafts never appear among entries and the diary's schema is untouched.
// Blobs are stored as ArrayBuffers (Safari), as storage.js does for entries.

const DB = 'sonmira-drafts', STORE = 'drafts', VERSION = 1;

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// Draft ⇄ stored record
export async function toRecord(d) {
  const r = { ...d, audio: null, audioType: d.audio?.type || null, audioBytes: d.audio ? await d.audio.arrayBuffer() : null };
  const art = d.painting?.artwork;
  if (art?.kind === 'image' && art.blob) {
    r.painting = { ...d.painting, artwork: { ...art, blob: null, bytes: await art.blob.arrayBuffer(), type: art.blob.type } };
  }
  return r;
}
export function fromRecord(r) {
  const d = { ...r, audio: r.audioBytes ? new Blob([r.audioBytes], { type: r.audioType || '' }) : null };
  delete d.audioBytes; delete d.audioType;
  const art = r.painting?.artwork;
  if (art?.kind === 'image' && art.bytes) {
    d.painting = { ...r.painting, artwork: { kind: 'image', focus: art.focus, blob: new Blob([art.bytes], { type: art.type || 'image/jpeg' }) } };
  }
  return d;
}

export function idbDraftStore({ indexedDB = globalThis.indexedDB } = {}) {
  let db = null;
  const open = () => db ?? (db = new Promise((res, rej) => {
    if (!indexedDB) return rej(new Error('IndexedDB unavailable'));
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'key' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('IndexedDB blocked'));
  }));
  const write = async (fn) => {
    const t = (await open()).transaction(STORE, 'readwrite');
    fn(t.objectStore(STORE));
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted')); });
  };
  return {
    kind: 'indexeddb',
    async ready() { await open(); return true; },
    async all() {
      const out = [];
      for (const r of await req((await open()).transaction(STORE, 'readonly').objectStore(STORE).getAll())) {
        try { out.push(fromRecord(r)); } catch (e) { console.warn('[sonmira] unreadable draft skipped', r?.key, e); }
      }
      return out;
    },
    async get(key) { const r = await req((await open()).transaction(STORE, 'readonly').objectStore(STORE).get(key)); return r ? fromRecord(r) : null; },
    async put(d) { const rec = await toRecord(d); await write((s) => s.put(rec)); },
    async remove(key) { await write((s) => s.delete(key)); },
  };
}

export function memoryDraftStore() {
  const m = new Map();
  return {
    kind: 'memory',
    async ready() { return false; },
    async all() { return [...m.values()]; },
    async get(key) { return m.get(key) ?? null; },
    async put(d) { m.set(d.key, d); },
    async remove(key) { m.delete(key); },
  };
}
