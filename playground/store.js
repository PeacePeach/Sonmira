// Local test library in IndexedDB: audio, settings, analysis and artwork for
// each run, so comparisons can be repeated after a reload.
const DB = 'sonmira-playground', STORE = 'runs';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
    const out = fn(s);
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}
export const saveRun = (run) => tx('readwrite', (s) => s.put(run));
export const deleteRun = (id) => tx('readwrite', (s) => s.delete(id));
export const listRuns = () => tx('readonly', (s) => s.getAll()).then((r) => r.sort((a, b) => b.createdAt - a.createdAt));
