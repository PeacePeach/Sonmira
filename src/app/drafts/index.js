// Recoverable drafts: a take that was sent to be painted, and its painting
// once it exists, kept on the device until the person chooses Keep it
// (it becomes a diary entry) or discards it.
//
//   begin(take)          before any paid call: the recording is safe from here
//   ready(key, painting) the painting exists; Keep it is still the person's call
//   failed(key, code)    the take stays; Try again re-asks with the same key
//   keep(key, entry)     diary entry written first, then the draft removed
//   discard(key)         gone for good
//
// The draft key is the take key the generation guard uses as its
// Idempotency-Key, so opening a draft that was still painting when the app
// closed gets the painting the server already made instead of a new one.
// Draft writes never block painting: if storage fails, painting goes on and
// the failure is returned (false) for the caller to decide.

import { idbDraftStore, memoryDraftStore } from './store.js';

export const entryIdFor = (key) => `e-${key}`;
export const STATUSES = ['painting', 'failed', 'ready'];

export function newTakeKey() {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return `t${Date.now().toString(36)}${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function createDrafts({ store = null, now = Date.now } = {}) {
  let s = store;
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => { try { fn(); } catch {} });
  const safe = async (fn) => { try { await fn(); return true; } catch (e) { console.warn('[sonmira] draft not saved', e); return false; } };

  async function patch(key, fields) {
    const d = await s.get(key);
    if (!d) return false;
    await s.put({ ...d, ...fields, updatedAt: now() });
    changed();
    return true;
  }

  return {
    /** Opens storage; falls back to memory (drafts then last only this session). */
    async init() {
      if (!s) {
        try { s = idbDraftStore(); await s.ready(); } catch (e) { console.warn('[sonmira] drafts in memory only', e); s = memoryDraftStore(); }
      }
      return s.kind !== 'memory';
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async list() { return (await s.all()).sort((a, b) => b.createdAt - a.createdAt); },
    get: (key) => s.get(key),

    /** @param {{key:string, audio:Blob, durationSec:number, analysis:any}} take */
    begin(take, { note = '', date } = {}) {
      return safe(async () => {
        const prev = await s.get(take.key);
        await s.put({
          key: take.key, createdAt: prev?.createdAt ?? now(), updatedAt: now(), date: prev?.date ?? date,
          status: 'painting', error: null, note, durationSec: take.durationSec, audio: take.audio, analysis: take.analysis,
          painting: prev?.painting ?? null, ...(prev?.journal ? { journal: prev.journal } : {}),
        });
        changed();
      });
    },
    ready(key, painting, note) { return safe(() => patch(key, { status: 'ready', painting, error: null, ...(note != null ? { note } : {}) })); },
    failed(key, code) { return safe(() => patch(key, { status: 'failed', error: code || 'error' })); },
    /** The title, and the optional journal when given (older callers pass only the title). */
    setNote(key, note, journal) { return safe(() => patch(key, { note, ...(journal != null ? { journal } : {}) })); },

    /** Writes the diary entry (addEntry throws on failure: the draft stays), then removes the draft. */
    async keep(key, entry, addEntry) {
      const full = { ...entry, id: entryIdFor(key) };
      await addEntry(full);
      await safe(async () => { await s.remove(key); changed(); });
      return full;
    },
    async discard(key) { await s.remove(key); changed(); },

    /** Drafts whose entry already exists (Keep it finished but the app closed before the draft went). */
    async reconcile(entryIds) {
      const ids = new Set(entryIds);
      for (const d of await s.all()) if (ids.has(entryIdFor(d.key))) await safe(() => s.remove(d.key));
    },
  };
}

/** The take a draft was made from, in the shape the Sing screen uses. */
export const takeOf = (d) => ({ key: d.key, audio: d.audio, durationSec: d.durationSec, analysis: d.analysis });
