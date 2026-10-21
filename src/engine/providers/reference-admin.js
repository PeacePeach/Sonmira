// SERVER ONLY: the reference admin portal's overlay on the reference
// registry (api/admin/references.js, admin/references/).
//
// The bundled registry (direct/references.js) and the images discovered in
// references/ stay exactly as they are. The portal writes only under its own
// prefix in the same private Blob store, one namespace per environment so a
// Preview never changes what Production paints:
//
//   reference-admin/<ns>/images/<tier>/<code|any>/<id>.<ext>  an added image
//   reference-admin/<ns>/archived/<id>.json   present = out of selection
//   reference-admin/<ns>/meta/<id>.json       portal-only details
//   reference-admin/<ns>/ids/<id>             id claim (atomic create)
//   reference-admin/<ns>/audit/<time>-<rand>.json  one record per change
//
// registryFor (reference-store.js) lists images/ and archived/ with the
// registry: an added image joins its tier (and family) exactly like an image
// discovered in references/, and an archived id becomes inactive. Nothing is
// ever deleted: archiving is a marker, restoring removes it.

import { createHash, randomBytes } from 'node:crypto';
import { FAMILIES } from '../direct/families.js';
import { REFERENCE_LIBRARY } from '../direct/references.js';
import { tierOf } from '../direct/library.js';
import { registryFor, forgetRegistry } from './reference-store.js';

export const TIERS = ['loose', 'gathered', 'resolved'];
export const MAX_BYTES = 4 * 1024 * 1024; // Vercel functions take 4.5 MB bodies
export const MIN_SIDE = 256;
export const MAX_SIDE = 8192;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Production and Preview never share a namespace; SONMIRA_REFERENCE_ADMIN_NS
// overrides (tests, a staging store).
export function adminNamespace(env = process.env) {
  const ns = env.SONMIRA_REFERENCE_ADMIN_NS || (env.VERCEL_ENV === 'production' ? 'production' : env.VERCEL_ENV === 'preview' ? 'preview' : 'development');
  if (!/^[a-z0-9-]{1,32}$/.test(ns)) throw new Error('invalid reference admin namespace');
  return ns;
}
// SONMIRA_REFERENCE_OVERLAY=0 turns the overlay off at generation: back to
// bundled + discovered only, whatever the portal stored.
export const overlayEnabled = (env = process.env) => env.SONMIRA_REFERENCE_OVERLAY !== '0';
const root = (ns) => `reference-admin/${ns}/`;
// An added reference's path, as direct() passes it on to loadImage:
// `admin:<ns>/images/…`, read from reference-admin/<ns>/images/… .
export const ADMIN_PATH = 'admin:';
export const adminBlobPath = (path) => (path?.startsWith(ADMIN_PATH) ? `reference-admin/${path.slice(ADMIN_PATH.length)}` : null);
const code = (family) => family.split('-')[0];
const familyOfCode = (c) => Object.keys(FAMILIES).find((id) => code(id) === c) || null;

// ---- Overlay, as generation sees it.

export async function loadOverlay(store, ns) {
  const [images, archived] = await Promise.all([store.raw.list(`${root(ns)}images/`), store.raw.list(`${root(ns)}archived/`)]);
  const added = [];
  for (const { pathname } of images) {
    const m = pathname.slice(root(ns).length).match(/^images\/(loose|gathered|resolved)\/([A-Za-z0-9]+)\/([A-Za-z0-9_-]+)\.(jpg|png|webp)$/);
    if (!m) continue;
    const [, tier, c, id] = m;
    const family = c === 'any' ? null : familyOfCode(c);
    if (c !== 'any' && (!family || FAMILIES[family].tier !== tier)) continue;
    const path = ADMIN_PATH + pathname.slice('reference-admin/'.length);
    added.push(family ? { id, family, path, active: true } : { id, tier, path, active: true });
  }
  const ids = new Set(archived.map((b) => b.pathname.match(/archived\/([A-Za-z0-9_-]+)\.json$/)?.[1]).filter(Boolean));
  return { added: added.sort((a, b) => (a.id < b.id ? -1 : 1)), archived: ids };
}

// The registry with the overlay applied. Returns `base` itself when the
// overlay changes nothing, so the library (and its version) stay identical.
export function applyOverlay(base, overlay) {
  if (!overlay) return base;
  const known = new Set(base.map((e) => e.id));
  const added = overlay.added.filter((e) => !known.has(e.id));
  const hits = base.some((e) => overlay.archived.has(e.id)) || added.length;
  if (!hits) return base;
  const retire = (e) => (overlay.archived.has(e.id) ? { ...e, active: false, archived: true } : e);
  return [...base.map(retire), ...added.map(retire)];
}

// ---- Upload validation: the file's own bytes decide its type, never its
// name or the browser's content type.

export function sniffImage(bytes) {
  const b = bytes;
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const le24 = (i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && String.fromCharCode(...b.slice(12, 16)) === 'IHDR') {
    return { mime: 'image/png', width: u32(16), height: u32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
      const len = u16(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) return { mime: 'image/jpeg', width: u16(i + 7), height: u16(i + 5) };
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...b.slice(12, 16));
    if (chunk === 'VP8X') return { mime: 'image/webp', width: le24(24) + 1, height: le24(27) + 1 };
    if (chunk === 'VP8 ') return { mime: 'image/webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (chunk === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { mime: 'image/webp', width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

const fail = (code, message) => Object.assign(new Error(message), { code, expected: true });

export function validateUpload({ tier, family, bytes, originalName, note }) {
  if (!TIERS.includes(tier)) throw fail('bad_tier', 'Choose Loose, Gathered or Resolved.');
  if (family && (!FAMILIES[family] || FAMILIES[family].tier !== tier)) throw fail('bad_family', `Family ${family} does not belong to ${tier}.`);
  if (!bytes?.length) throw fail('empty', 'The file is empty.');
  if (bytes.length > MAX_BYTES) throw fail('too_large', `The file is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  const img = sniffImage(bytes);
  if (!img) throw fail('bad_format', 'Only JPEG, PNG or WebP images are accepted.');
  if (Math.min(img.width, img.height) < MIN_SIDE) throw fail('too_small', `The image is ${img.width}×${img.height}; its short side must be at least ${MIN_SIDE} px.`);
  if (Math.max(img.width, img.height) > MAX_SIDE) throw fail('too_big', `The image is ${img.width}×${img.height}; its long side must be at most ${MAX_SIDE} px.`);
  return { ...img, ext: EXT[img.mime], originalName: String(originalName ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 120) || null, note: String(note ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300) || null };
}

// ---- Admin operations.

const json = (v) => JSON.stringify(v, null, 1);
const readJson = async (store, pathname) => {
  try { const b = await store.raw.get(pathname); return b ? JSON.parse(new TextDecoder().decode(b)) : null; } catch { return null; }
};
const exists = (e) => /exist/i.test(String(e?.message ?? e));

export async function audit(store, ns, record, now = Date.now) {
  const at = new Date(now()).toISOString();
  await store.raw.put(`${root(ns)}audit/${at.replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.json`, json({ at, ...record }), { contentType: 'application/json' });
}

// Next `<tier>_NN` after every id the tier has ever had (bundled, discovered,
// added, archived, or claimed by an upload that failed half-way). The claim
// is an atomic create, so two uploads at the same moment never share an id.
async function claimId(store, ns, tier, registry) {
  const claimed = (await store.raw.list(`${root(ns)}ids/`)).map((b) => b.pathname.split('/').pop());
  const re = new RegExp(`^${tier}_(\\d+)$`);
  let n = Math.max(0, ...[...registry.map((e) => e.id), ...claimed].map((id) => Number(id.match(re)?.[1] ?? 0))) + 1;
  for (let tries = 0; tries < 25; tries++, n++) {
    const id = `${tier}_${String(n).padStart(2, '0')}`;
    if (registry.some((e) => e.id === id)) continue;
    try {
      await store.raw.put(`${root(ns)}ids/${id}`, 'claimed', { contentType: 'text/plain' });
      return id;
    } catch (e) {
      if (!exists(e)) throw e;
    }
  }
  throw fail('id_busy', 'Could not reserve a reference id; try again.');
}

export async function uploadReference(store, env, input, { now = Date.now } = {}) {
  const ns = adminNamespace(env);
  const v = validateUpload(input);
  const registry = await registryFor(store, { fresh: true, env });
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const metas = await adminMetas(store, ns, registry);
  const dup = [...metas.values()].find((m) => m.sha256 === sha256);
  if (dup) throw fail('duplicate', `This image is already in the library as ${dup.id}.`);
  const id = await claimId(store, ns, input.tier, registry);
  const pathname = `${root(ns)}images/${input.tier}/${input.family ? code(input.family) : 'any'}/${id}.${v.ext}`;
  await store.raw.put(pathname, input.bytes, { contentType: v.mime });
  const meta = { id, tier: input.tier, family: input.family || null, fileName: `${id}.${v.ext}`, originalName: v.originalName, note: v.note, mime: v.mime, bytes: input.bytes.length, width: v.width, height: v.height, sha256, addedAt: new Date(now()).toISOString() };
  await store.raw.put(`${root(ns)}meta/${id}.json`, json(meta), { contentType: 'application/json', overwrite: true });
  await audit(store, ns, { action: 'upload', id, tier: meta.tier, family: meta.family, fileName: meta.fileName, originalName: meta.originalName, bytes: meta.bytes, sha256 }, now);
  forgetRegistry(store);
  return meta;
}

// A tier, and a family that has references, always keeps one in selection.
export function archiveBlocker(registry, id) {
  const e = registry.find((x) => x.id === id);
  if (!e) return 'unknown';
  if (!e.active) return 'already_archived';
  const others = registry.filter((x) => x.active && x.id !== id);
  if (!others.some((x) => tierOf(x) === tierOf(e))) return 'last_in_tier';
  if (e.family && !others.some((x) => x.family === e.family)) return 'last_in_family';
  return null;
}
const BLOCKED = {
  unknown: [404, 'No such reference.'],
  already_archived: [409, 'This reference is already archived.'],
  last_in_tier: [409, 'This is the last usable reference in its category; add another before archiving it.'],
  last_in_family: [409, 'This is the last usable reference in its family; add another to the family before archiving it.'],
};

export async function archiveReference(store, env, id, { reason, now = Date.now } = {}) {
  if (!ID.test(String(id))) throw fail('bad_id', 'Invalid id.');
  const ns = adminNamespace(env);
  const registry = await registryFor(store, { fresh: true, env });
  const blocked = archiveBlocker(registry, id);
  if (blocked) throw Object.assign(fail(blocked, BLOCKED[blocked][1]), { status: BLOCKED[blocked][0] });
  const e = registry.find((x) => x.id === id);
  const at = new Date(now()).toISOString();
  const why = String(reason ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300) || null;
  await store.raw.put(`${root(ns)}archived/${id}.json`, json({ id, at, reason: why }), { contentType: 'application/json', overwrite: true });
  await audit(store, ns, { action: 'archive', id, tier: tierOf(e), family: e.family ?? null, reason: why }, now);
  forgetRegistry(store);
  return { id, archivedAt: at };
}

export async function restoreReference(store, env, id, { now = Date.now } = {}) {
  if (!ID.test(String(id))) throw fail('bad_id', 'Invalid id.');
  const ns = adminNamespace(env);
  const registry = await registryFor(store, { fresh: true, env });
  const e = registry.find((x) => x.id === id);
  if (!e) throw Object.assign(fail('unknown', 'No such reference.'), { status: 404 });
  if (!e.archived) throw Object.assign(fail('not_archived', 'This reference is not archived.'), { status: 409 });
  await store.raw.del(`${root(ns)}archived/${id}.json`);
  await audit(store, ns, { action: 'restore', id, tier: tierOf(e), family: e.family ?? null }, now);
  forgetRegistry(store);
  return { id };
}

async function adminMetas(store, ns, registry) {
  const added = registry.filter((e) => adminBlobPath(e.path));
  const metas = await Promise.all(added.map((e) => readJson(store, `${root(ns)}meta/${e.id}.json`)));
  return new Map(added.map((e, i) => [e.id, metas[i] ?? { id: e.id }]));
}

// Everything the portal shows: one row per reference, in the registry
// /api/generate selects from right now (fresh, not the 30 s cache).
export async function listReferences(store, env) {
  const ns = adminNamespace(env);
  const registry = await registryFor(store, { fresh: true, env });
  const bundled = new Set(REFERENCE_LIBRARY.map((e) => e.id));
  const metas = await adminMetas(store, ns, registry);
  const archivedIds = registry.filter((e) => e.archived).map((e) => e.id);
  const archivedDocs = new Map((await Promise.all(archivedIds.map((id) => readJson(store, `${root(ns)}archived/${id}.json`)))).filter(Boolean).map((d) => [d.id, d]));
  const rows = registry.filter((e) => tierOf(e)).map((e) => {
    const m = metas.get(e.id) ?? {};
    const a = archivedDocs.get(e.id);
    return {
      id: e.id, tier: tierOf(e), family: e.family ?? null, familyLabel: e.family ? FAMILIES[e.family]?.label ?? null : null,
      source: bundled.has(e.id) ? 'original' : adminBlobPath(e.path) ? 'portal' : 'storage',
      fileName: e.path.split('/').pop(), active: Boolean(e.active), archived: Boolean(e.archived),
      archivedAt: a?.at ?? null, archiveReason: a?.reason ?? null,
      palette: Boolean(e.palette?.colors?.length), originalName: m.originalName ?? null, note: m.note ?? null,
      width: m.width ?? null, height: m.height ?? null, bytes: m.bytes ?? null, addedAt: m.addedAt ?? null,
    };
  });
  const counts = Object.fromEntries(TIERS.map((t) => [t, { active: rows.filter((r) => r.tier === t && r.active).length, archived: rows.filter((r) => r.tier === t && r.archived).length }]));
  const families = Object.entries(FAMILIES).map(([id, f]) => ({ id, tier: f.tier, label: f.label, active: rows.filter((r) => r.family === id && r.active).length }));
  return { namespace: ns, rows, counts, families };
}

export async function auditLog(store, env, limit = 50) {
  const ns = adminNamespace(env);
  const all = (await store.raw.list(`${root(ns)}audit/`)).map((b) => b.pathname).sort().reverse().slice(0, limit);
  return (await Promise.all(all.map((p) => readJson(store, p)))).filter(Boolean);
}
