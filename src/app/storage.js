// Local persistence. Entries (metadata + audio bytes + painting) live in
// IndexedDB; audio is stored as an ArrayBuffer for maximum Safari
// compatibility. If IndexedDB is unavailable (some private modes) we fall back
// to memory and the app tells the user entries won't survive a reload.

const DB = 'sonmira', STORE = 'entries', VERSION = 1;
let db = null;
let memory = null; // Map when falling back

function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

function openDb() {
  return new Promise((res, rej) => {
    if (!globalThis.indexedDB) return rej(new Error('IndexedDB unavailable'));
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('IndexedDB blocked'));
  });
}

/** @returns {Promise<{persistent: boolean}>} */
export async function initStorage() {
  try {
    db = await openDb();
    navigator.storage?.persist?.().catch(() => {});
    return { persistent: true };
  } catch (e) {
    console.warn('[sonmira] storage fallback to memory', e);
    memory = new Map();
    return { persistent: false };
  }
}

const tx = (mode) => db.transaction(STORE, mode).objectStore(STORE);

// Blob ⇄ stored record
async function toRecord(entry) {
  const r = { ...entry, audio: null, audioType: entry.audio?.type || null };
  if (entry.audio) r.audioBytes = await entry.audio.arrayBuffer();
  const art = entry.painting?.artwork;
  if (art?.kind === 'image' && art.blob) {
    r.painting = { ...entry.painting, artwork: { ...art, blob: null, bytes: await art.blob.arrayBuffer(), type: art.blob.type } };
  }
  return r;
}
function fromRecord(r) {
  const e = { ...r };
  e.audio = r.audioBytes ? new Blob([r.audioBytes], { type: r.audioType || '' }) : null;
  delete e.audioBytes;
  const art = r.painting?.artwork;
  if (art?.kind === 'image' && art.bytes) {
    e.painting = { ...r.painting, artwork: { kind: 'image', focus: art.focus, blob: new Blob([art.bytes], { type: art.type || 'image/png' }) } };
  }
  return e;
}

export async function listEntries() {
  if (memory) return [...memory.values()];
  return (await req(tx('readonly').getAll())).map(fromRecord);
}

export async function putEntry(entry) {
  if (memory) { memory.set(entry.id, entry); return; }
  const rec = await toRecord(entry);
  await new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(rec);
    t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted'));
  });
}

export async function removeEntry(id) {
  if (memory) { memory.delete(id); return; }
  await req(tx('readwrite').delete(id));
}

export async function clearEntries() {
  if (memory) { memory.clear(); return; }
  await req(tx('readwrite').clear());
}
