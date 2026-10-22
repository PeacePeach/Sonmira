// The reference admin portal (server/reference-admin-api.js via /api/reference?admin=1, reference-admin.js):
// upload, naming, category assignment, archive/restore, permissions, audit,
// and that its references go through the existing engine unchanged.
// In-memory @vercel/blob and a mocked OpenAI: no network, no paid calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY } from '../../src/engine/direct/library.js';
import { REFERENCE_LIBRARY } from '../../src/engine/direct/references.js';
import { direct, REFERENCE_ONLY_STYLE } from '../../src/engine/direct/index.js';
import { blobStore, libraryFor, registryFor } from '../../src/engine/providers/reference-store.js';
import { adminNamespace, applyOverlay, archiveBlocker, sniffImage, uploadReference, archiveReference, restoreReference } from '../../src/engine/providers/reference-admin.js';
import { sessionToken } from '../../server/reference-admin-api.js';
import { createHandler as referenceHandler } from '../../api/reference.js';

// The portal's API is served by /api/reference with admin=1.
const adminHandler = (o) => referenceHandler(o);
import { createHandler as generateHandler, eligibleRecentReferences } from '../../api/generate.js';

const PASSWORD = 'correct horse battery staple';
const ENV = { VERCEL_ENV: 'preview', SONMIRA_ADMIN_PASSWORD: PASSWORD };

// Blob with the real semantics that matter here: private access, put fails
// on an existing pathname unless allowOverwrite, paged list, async gaps so
// concurrent requests interleave.
function fakeBlob(pathnames = REFERENCE_LIBRARY.map((e) => `references/${e.path}`)) {
  const files = new Map(pathnames.map((p) => [p, { bytes: new Uint8Array([0xff, 0xd8, 9]), contentType: 'image/jpeg' }]));
  const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));
  return {
    files,
    async list({ prefix, cursor }) {
      await tick();
      const all = [...files.keys()].filter((p) => p.startsWith(prefix)).sort();
      const at = Number(cursor ?? 0);
      return { blobs: all.slice(at, at + 3).map((pathname) => ({ pathname, size: files.get(pathname).bytes.length })), hasMore: at + 3 < all.length, cursor: String(at + 3) };
    },
    async get(pathname, o) {
      assert.equal(o.access, 'private');
      await tick();
      return files.has(pathname) ? { statusCode: 200, stream: new Blob([files.get(pathname).bytes]).stream() } : null;
    },
    async put(pathname, body, o) {
      assert.equal(o.access, 'private');
      assert.equal(o.addRandomSuffix, false);
      if (files.has(pathname) && !o.allowOverwrite) throw new Error('Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.');
      files.set(pathname, { bytes: typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body), contentType: o.contentType });
      await tick();
      return { pathname };
    },
    async del(pathname) { await tick(); files.delete(pathname); },
  };
}

// Minimal valid image headers with real dimensions.
function png(w = 1024, h = 1280, salt = 0) {
  const b = new Uint8Array(64 + salt);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b[63 + salt] = salt & 0xff;
  return b;
}
function jpeg(w = 900, h = 1200) {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 0, 0, 0, 0xff, 0xd9]);
}
let salt = 1;
const uniq = () => png(1024, 1280, salt++);

const setup = (env = ENV) => {
  const client = fakeBlob();
  return { client, store: blobStore({ client }), env };
};
const adminFiles = (client) => [...client.files.keys()].filter((p) => p.startsWith('reference-admin/'));

// ---- HTTP helpers for the admin API.
function call(handler, { method = 'GET', action, query = {}, body, cookie, csrf = true, host = 'sonmira-test.vercel.app' }) {
  return new Promise((resolve) => {
    const headers = { host };
    if (cookie) headers.cookie = cookie;
    if (method === 'POST' && csrf) headers['x-sonmira-admin'] = '1';
    const res = {
      headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.code = c; return this; },
      json(j) { resolve({ code: this.code, json: j, headers: this.headers }); },
      end(b) { resolve({ code: this.code, bytes: b, headers: this.headers }); },
    };
    handler({ method, headers, query: { admin: '1', action, ...query }, body, socket: { remoteAddress: '1.2.3.4' } }, res);
  });
}
async function signIn(handler) {
  const r = await call(handler, { method: 'POST', action: 'login', body: { password: PASSWORD } });
  assert.equal(r.code, 200);
  return r.headers['set-cookie'].split(';')[0];
}

// ---- Engine compatibility.

test('with nothing in the portal, generation selects exactly as before', async () => {
  const { store } = setup();
  assert.equal(await registryFor(store, { env: ENV }), REFERENCE_LIBRARY);
  assert.equal(await libraryFor(store, { env: ENV }), LIBRARY);
  assert.equal(applyOverlay(REFERENCE_LIBRARY, { added: [], archived: new Set() }), REFERENCE_LIBRARY);
});

test('an upload gets the next id and file name of its category', async () => {
  const { client, store, env } = setup();
  const r = await uploadReference(store, env, { tier: 'resolved', bytes: uniq(), originalName: 'balcony.png' });
  assert.equal(r.id, 'resolved_15'); // after the bundled resolved_01..resolved_14
  assert.equal(r.fileName, 'resolved_15.png');
  assert.ok(client.files.has('reference-admin/preview/images/resolved/any/resolved_15.png'));
  const g = await uploadReference(store, env, { tier: 'gathered', family: 'G2-splash-wash', bytes: jpeg() });
  assert.deepEqual([g.id, g.fileName, g.family], ['gathered_06', 'gathered_06.jpg', 'G2-splash-wash']);
  assert.ok(client.files.has('reference-admin/preview/images/gathered/G2/gathered_06.jpg'));
  assert.equal((await uploadReference(store, env, { tier: 'loose', bytes: uniq() })).id, 'loose_04');
  // Nothing under references/ (the bundled images) was written.
  assert.deepEqual([...client.files.keys()].filter((p) => p.startsWith('references/')).sort(), REFERENCE_LIBRARY.map((e) => `references/${e.path}`).sort());
});

test('concurrent uploads never share an id', async () => {
  const { store, env } = setup();
  const out = await Promise.all(Array.from({ length: 8 }, () => uploadReference(store, env, { tier: 'resolved', bytes: uniq() })));
  const ids = out.map((r) => r.id);
  assert.equal(new Set(ids).size, 8);
  assert.deepEqual([...ids].sort(), Array.from({ length: 8 }, (_, i) => `resolved_${15 + i}`));
});

test('an uploaded reference joins its tier pool and is painted by the existing pipeline', async () => {
  const { client, store, env } = setup();
  const bytes = uniq();
  await uploadReference(store, env, { tier: 'resolved', family: 'R4-lyrical-everyday', bytes });
  await uploadReference(store, env, { tier: 'resolved', bytes: uniq() });
  const lib = await libraryFor(store, { env });
  assert.notEqual(lib.version, LIBRARY.version);
  assert.equal(lib.tierPool('resolved').length, 16);
  assert.ok(lib.pool('R4-lyrical-everyday').some((e) => e.id === 'resolved_15'));
  // Family-less: the same path as an image dropped into references/resolved/.
  const d = direct({ completeness: 'resolved', emotion: 'tender', motif: 'water', seed: 1, reference: 'resolved_16', energy: { value: 'calm' }, library: lib });
  assert.equal(d.reference.id, 'resolved_16');
  assert.equal(d.sections.family, REFERENCE_ONLY_STYLE);
  // Every other reference keeps its exact entry.
  for (const e of REFERENCE_LIBRARY) assert.equal(lib.get(e.id), e);

  // /api/generate draws it by seed like any other and sends its own bytes.
  const sentBytes = [];
  const fakeOpenAI = async (url, init) => {
    for (const [k, v] of init.body.entries?.() ?? []) if (k.startsWith('image') && v.size) sentBytes.push(new Uint8Array(await v.arrayBuffer()));
    return { ok: true, text: async () => 'data: {"type":"image_edit.completed","b64_json":"QQ=="}\n', json: async () => ({ data: [{ b64_json: 'QQ==' }] }) };
  };
  const handler = generateHandler({ store, env: { ...env, OPENAI_API_KEY: 'test-no-network' }, fetchImpl: fakeOpenAI, kv: null });
  let hit = null;
  for (let seed = 1; seed < 300 && !hit; seed++) {
    let out;
    const res = { setHeader() {}, status() { return this; }, json(j) { out = j; } };
    await handler({ method: 'POST', body: { spec: { completeness: 'resolved', emotion: 'tender', motif: 'water', seed, energy: { value: 'calm' } } } }, res);
    assert.ok(out.ok, out.error);
    if (out.reference === 'resolved_15') hit = out;
  }
  assert.ok(hit, 'resolved_15 is drawn for some seed');
  assert.equal(hit.family, 'R4-lyrical-everyday');
  assert.equal(hit.referenceSent, true);
  assert.ok(sentBytes.some((b) => b.length === bytes.length && b.every((x, i) => x === bytes[i])), 'the uploaded image itself is sent as the style reference');
  assert.ok(client.files.size > REFERENCE_LIBRARY.length);
});

test('recent-five avoidance covers uploaded references too', async () => {
  const { store, env } = setup();
  await uploadReference(store, env, { tier: 'loose', bytes: uniq() });
  const pool = (await libraryFor(store, { env })).tierPool('loose');
  assert.equal(pool.length, 4);
  const history = [{ id: 'loose_04' }, { id: 'loose_01' }];
  assert.deepEqual(eligibleRecentReferences(pool, history).map((e) => e.id).sort(), ['loose_02', 'loose_03']);
});

test('an archived reference is never drawn again, and restoring brings it back', async () => {
  const { client, store, env } = setup();
  await archiveReference(store, env, 'resolved_03', { reason: 'too close to resolved_04' });
  const lib = await libraryFor(store, { env });
  assert.ok(!lib.tierPool('resolved').some((e) => e.id === 'resolved_03'));
  assert.equal(lib.tierPool('resolved').length, 13);
  for (let seed = 0; seed < 2000; seed++) assert.notEqual(lib.selectInTier('resolved', seed).id, 'resolved_03');
  // A pin (Playground) or an old request naming it cannot bring it back.
  const d = direct({ completeness: 'resolved', emotion: 'tender', motif: 'water', seed: 3, reference: 'resolved_03', energy: { value: 'calm' }, library: lib });
  assert.notEqual(d.reference.id, 'resolved_03');
  // Kept, not deleted: the image is still in storage and readable.
  assert.ok(client.files.has(`references/${REFERENCE_LIBRARY.find((e) => e.id === 'resolved_03').path}`));
  assert.ok((await store.loadImage(lib.get('resolved_03'))).bytes.length > 0);

  const handler = generateHandler({ store, env: { ...env, OPENAI_API_KEY: 'test-no-network' }, fetchImpl: async () => ({ ok: true, text: async () => 'data: {"type":"image_edit.completed","b64_json":"QQ=="}\n' }), kv: null });
  for (let seed = 1; seed < 80; seed++) {
    let out;
    const res = { setHeader() {}, status() { return this; }, json(j) { out = j; } };
    await handler({ method: 'POST', body: { spec: { completeness: 'resolved', emotion: 'tender', motif: 'water', seed, energy: { value: 'calm' } } } }, res);
    assert.ok(out.ok);
    assert.notEqual(out.reference, 'resolved_03');
  }

  await restoreReference(store, env, 'resolved_03');
  assert.equal(await libraryFor(store, { env }), LIBRARY);
});

test('the last usable reference of a category or family cannot be archived', async () => {
  const { store, env } = setup();
  // Each Loose family has one reference.
  await assert.rejects(archiveReference(store, env, 'loose_01'), { code: 'last_in_family' });
  const reg = REFERENCE_LIBRARY.map((e) => ({ ...e }));
  const loose = reg.filter((e) => e.family?.startsWith('L'));
  loose.slice(1).forEach((e) => { e.active = false; });
  loose[0].family = null; loose[0].tier = 'loose';
  assert.equal(archiveBlocker(reg, loose[0].id), 'last_in_tier');
  // A new reference in the family lifts the guard.
  const added = await uploadReference(store, env, { tier: 'loose', family: (REFERENCE_LIBRARY.find((e) => e.id === 'loose_01')).family, bytes: uniq() });
  await archiveReference(store, env, 'loose_01');
  await assert.rejects(archiveReference(store, env, added.id), { code: 'last_in_family' });
  await assert.rejects(archiveReference(store, env, 'loose_01'), { code: 'already_archived' });
  await assert.rejects(archiveReference(store, env, 'nope'), { code: 'unknown' });
});

test('uploads are validated by their bytes', async () => {
  const { client, store, env } = setup();
  const before = client.files.size;
  const up = (x) => uploadReference(store, env, { tier: 'resolved', bytes: uniq(), ...x });
  await assert.rejects(up({ bytes: new TextEncoder().encode('<svg onload=alert(1)>') }), { code: 'bad_format' });
  await assert.rejects(up({ bytes: png(200, 900) }), { code: 'too_small' });
  await assert.rejects(up({ bytes: new Uint8Array(4 * 1024 * 1024 + 1).fill(1) }), { code: 'too_large' });
  await assert.rejects(up({ bytes: new Uint8Array() }), { code: 'empty' });
  await assert.rejects(up({ tier: 'nope' }), { code: 'bad_tier' });
  await assert.rejects(up({ family: 'G1-atmospheric-study' }), { code: 'bad_family' });
  await assert.rejects(up({ family: 'X9-made-up' }), { code: 'bad_family' });
  assert.equal(client.files.size, before, 'a rejected upload writes nothing');
  const same = uniq();
  await up({ bytes: same });
  await assert.rejects(up({ bytes: same }), { code: 'duplicate' });
  assert.deepEqual(sniffImage(jpeg(640, 800)), { mime: 'image/jpeg', width: 640, height: 800 });
  const webp = new Uint8Array(40);
  webp.set(new TextEncoder().encode('RIFF'), 0); webp.set(new TextEncoder().encode('WEBPVP8X'), 8);
  webp.set([0xff, 0x03, 0x00, 0xff, 0x04, 0x00], 24);
  assert.deepEqual(sniffImage(webp), { mime: 'image/webp', width: 1024, height: 1280 });
});

test('Preview and Production portals never see each other\'s changes', async () => {
  const client = fakeBlob();
  const store = blobStore({ client });
  const prod = { VERCEL_ENV: 'production', SONMIRA_ADMIN_PASSWORD: PASSWORD };
  assert.equal(adminNamespace(ENV), 'preview');
  assert.equal(adminNamespace(prod), 'production');
  await uploadReference(store, ENV, { tier: 'resolved', bytes: uniq() });
  await archiveReference(store, ENV, 'gathered_01');
  const prodStore = blobStore({ client });
  assert.equal(await libraryFor(prodStore, { env: prod }), LIBRARY);
  // The kill switch: back to bundled + discovered, whatever is stored.
  assert.equal(await libraryFor(blobStore({ client }), { env: { ...ENV, SONMIRA_REFERENCE_OVERLAY: '0' } }), LIBRARY);
});

test('a failing overlay listing never stops painting', async () => {
  const { client, store, env } = setup();
  await uploadReference(store, env, { tier: 'resolved', bytes: uniq() });
  const list = client.list;
  client.list = async (o) => { if (o.prefix.startsWith('reference-admin/')) throw new Error('down'); return list.call(client, o); };
  // Cold instance: bundled + discovered only.
  assert.equal(await libraryFor(blobStore({ client }), { env }), LIBRARY);
  // Warm instance: keeps its last good overlay.
  client.list = list;
  const warm = blobStore({ client });
  const t = { now: 0 };
  assert.equal((await libraryFor(warm, { env, now: () => t.now })).tierPool('resolved').length, 15);
  client.list = async (o) => { if (o.prefix.startsWith('reference-admin/')) throw new Error('down'); return list.call(client, o); };
  t.now += 60_000;
  assert.equal((await libraryFor(warm, { env, now: () => t.now })).tierPool('resolved').length, 15);
});

// ---- The admin API: permissions, flow and audit.

test('the portal is off without a strong admin password', async () => {
  const { store } = setup();
  for (const env of [{}, { SONMIRA_ADMIN_PASSWORD: 'short' }]) {
    const r = await call(adminHandler({ store, env }), { action: 'list' });
    assert.equal(r.code, 404);
  }
});

test('every reading and editing action needs a valid session', async () => {
  const { client, store, env } = setup();
  const h = adminHandler({ store, env });
  const before = client.files.size;
  assert.equal((await call(h, { action: 'list' })).code, 401);
  assert.equal((await call(h, { action: 'image', query: { id: 'resolved_01' } })).code, 401);
  assert.equal((await call(h, { method: 'POST', action: 'upload', query: { tier: 'resolved' }, body: Buffer.from(uniq()) })).code, 401);
  assert.equal((await call(h, { method: 'POST', action: 'archive', body: { id: 'resolved_01' } })).code, 401);
  assert.equal((await call(h, { method: 'POST', action: 'restore', body: { id: 'resolved_01' } })).code, 401);
  assert.equal((await call(h, { action: 'audit' })).code, 401);
  // Wrong password, forged and foreign-namespace cookies.
  assert.equal((await call(h, { method: 'POST', action: 'login', body: { password: 'wrong password!!' } })).code, 401);
  const forged = `sonmira_ref_admin=v1.9999999999.${'A'.repeat(43)}`;
  assert.equal((await call(h, { action: 'list', cookie: forged })).code, 401);
  const otherNs = `sonmira_ref_admin=${sessionToken(PASSWORD, 'production')}`;
  assert.equal((await call(h, { action: 'list', cookie: otherNs })).code, 401);
  const expired = `sonmira_ref_admin=${sessionToken(PASSWORD, 'preview', () => Date.now() - 13 * 3600e3)}`;
  assert.equal((await call(h, { action: 'list', cookie: expired })).code, 401);
  // Sessions die when the password changes.
  const old = `sonmira_ref_admin=${sessionToken('an older password', 'preview')}`;
  assert.equal((await call(h, { action: 'list', cookie: old })).code, 401);
  // A signed-in POST without the admin header (a cross-site form) is refused.
  const cookie = await signIn(h);
  assert.equal((await call(h, { method: 'POST', action: 'archive', body: { id: 'resolved_01' }, cookie, csrf: false })).code, 403);
  assert.equal(client.files.size, before);
});

test('the session cookie is HttpOnly, Strict, Secure and scoped to the admin API', async () => {
  const { store, env } = setup();
  const r = await call(adminHandler({ store, env }), { method: 'POST', action: 'login', body: { password: PASSWORD } });
  const c = r.headers['set-cookie'];
  for (const part of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/api/reference']) assert.ok(c.includes(part), part);
  assert.ok(!c.includes(PASSWORD));
});

test('upload, list, view, archive, restore and audit through the API', async () => {
  const { store, env } = setup();
  const h = adminHandler({ store, env });
  const cookie = await signIn(h);
  const bytes = uniq();
  const up = await call(h, { method: 'POST', action: 'upload', query: { tier: 'gathered', family: 'G3-luminous-contrast', name: 'dusk.png', note: 'warm dusk' }, body: Buffer.from(bytes), cookie });
  assert.equal(up.code, 200, up.json.error);
  assert.deepEqual([up.json.reference.id, up.json.reference.fileName], ['gathered_06', 'gathered_06.png']);
  const bad = await call(h, { method: 'POST', action: 'upload', query: { tier: 'gathered' }, body: Buffer.from('not an image'), cookie });
  assert.equal(bad.code, 400);
  assert.match(bad.json.error, /JPEG, PNG or WebP/);

  const list = (await call(h, { action: 'list', cookie })).json;
  assert.equal(list.namespace, 'preview');
  assert.equal(list.counts.gathered.active, 6);
  assert.equal(list.counts.resolved.active, 14);
  assert.equal(list.counts.loose.active, 3);
  const row = list.rows.find((r) => r.id === 'gathered_06');
  assert.deepEqual([row.source, row.family, row.originalName, row.note, row.width, row.height], ['portal', 'G3-luminous-contrast', 'dusk.png', 'warm dusk', 1024, 1280]);
  assert.equal(list.rows.find((r) => r.id === 'resolved_01').source, 'original');
  assert.ok(list.pools.gathered.pool.includes('gathered_06'));
  assert.ok(Math.abs(list.pools.gathered.share.gathered_06 - 100 / 6) < 3, 'drawn like any other reference');
  assert.equal(list.families.find((f) => f.id === 'G3-luminous-contrast').active, list.rows.filter((r) => r.family === 'G3-luminous-contrast').length);
  // No storage path or URL in what the browser gets.
  assert.doesNotMatch(JSON.stringify(list), /reference-admin\/|blob\.vercel|https?:/);

  const img = await call(h, { action: 'image', query: { id: 'gathered_06' }, cookie });
  assert.equal(img.headers['content-type'], 'image/png');
  assert.equal(img.bytes.length, bytes.length);

  assert.equal((await call(h, { method: 'POST', action: 'archive', body: { id: 'gathered_06', reason: 'test' }, cookie })).code, 200);
  const after = (await call(h, { action: 'list', cookie })).json;
  assert.ok(!after.pools.gathered.pool.includes('gathered_06'));
  assert.equal(after.rows.find((r) => r.id === 'gathered_06').archived, true);
  assert.equal(after.rows.find((r) => r.id === 'gathered_06').archiveReason, 'test');
  // Archived images stay viewable in the portal.
  assert.equal((await call(h, { action: 'image', query: { id: 'gathered_06' }, cookie })).code, 200);
  const blocked = await call(h, { method: 'POST', action: 'archive', body: { id: 'loose_02' }, cookie });
  assert.equal(blocked.code, 409);
  assert.match(blocked.json.error, /last usable reference/);
  assert.equal((await call(h, { method: 'POST', action: 'restore', body: { id: 'gathered_06' }, cookie })).code, 200);

  const log = (await call(h, { action: 'audit', cookie })).json.entries;
  assert.deepEqual(log.map((a) => a.action), ['restore', 'archive', 'upload']);
  assert.equal(log[2].originalName, 'dusk.png');
  assert.equal(log[1].reason, 'test');
});

test('/api/reference?check=1 reads portal uploads through the same store', async () => {
  const { store, env } = setup();
  await uploadReference(store, env, { tier: 'resolved', bytes: uniq() });
  const { checkAll } = await import('../../api/reference.js');
  const report = await checkAll(store, await registryFor(store, { env }));
  assert.ok(report.items.some((i) => i.id === 'resolved_15' && i.ok));
});
