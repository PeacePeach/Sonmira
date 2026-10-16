// Manage the production reference library in private Vercel Blob storage.
// Needs BLOB_READ_WRITE_TOKEN, e.g. `vercel env pull .env.local` and then
// `node --env-file=.env.local tools/references.mjs …`; `add` also needs
// python3 with Pillow for palette measurement. Never commit the token.
//
//   node tools/references.mjs add <image> <FAMILY> [--id ID] [--light TEXT] [--motif M]
//        upload privately, assign to a family (full id or code, e.g. R4),
//        measure its palette, add it to the registry → eligible at once
//   node tools/references.mjs disable <id>    keep it, stop selecting it
//   node tools/references.mjs enable <id>
//   node tools/references.mjs remove <id>     delete the image and its entry
//   node tools/references.mjs list
//   node tools/references.mjs verify
//        read the registry and every active image back through the same
//        code the server uses, and report counts and sizes
//   node tools/references.mjs sync <refs_root>
//        setup: upload every reference in the bundled registry
//        (src/engine/direct/references.js) from a local folder that is not
//        in Blob's registry yet, then add those entries to it
//
// The deployed app re-reads the registry within REGISTRY_TTL_MS; no
// redeploy is needed.

import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FAMILIES } from '../src/engine/direct/families.js';
import { REFERENCE_LIBRARY } from '../src/engine/direct/references.js';
import { blobStore, addReference, setReferenceActive, removeReference } from '../src/engine/providers/reference-store.js';
import { createLibrary } from '../src/engine/direct/library.js';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest.splice(i, 2)[1] : undefined; };
const measure = (file) => JSON.parse(execFileSync('python3', [new URL('./index_references.py', import.meta.url).pathname, '--measure', file], { encoding: 'utf8' }));
const familyOf = (a) => FAMILIES[a] ? a : Object.keys(FAMILIES).find((id) => id.split('-')[0].toUpperCase() === String(a).toUpperCase());

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is not set. Run `vercel env pull` (or export it in this shell); never commit it.');
  process.exit(2);
}
const store = blobStore({ token: process.env.BLOB_READ_WRITE_TOKEN });

if (cmd === 'add') {
  const id = opt('id'), light = opt('light'), motif = opt('motif');
  const [file, fam] = rest;
  const family = familyOf(fam);
  if (!file || !family) { console.error('usage: add <image> <FAMILY> [--id ID] [--light TEXT] [--motif M]'); process.exit(2); }
  const e = await addReference(store, { family, fileName: basename(file), bytes: await readFile(file), palette: measure(file), id, light, motif });
  console.log(`added ${e.id} → ${e.family} (${e.path}); dominant ${e.palette.colors[0]?.hex}`);
} else if (cmd === 'disable' || cmd === 'enable') {
  await setReferenceActive(store, rest[0], cmd === 'enable');
  console.log(`${cmd}d ${rest[0]}`);
} else if (cmd === 'remove') {
  await removeReference(store, rest[0]);
  console.log(`removed ${rest[0]}`);
} else if (cmd === 'list') {
  const entries = await store.loadRegistry({ fresh: true });
  for (const e of entries) console.log(`${e.active ? ' ' : 'x'} ${e.id.padEnd(16)} ${String(e.family).padEnd(22)} ${e.path}`);
  console.log(`library version ${createLibrary(entries).version}`);
} else if (cmd === 'verify') {
  const entries = await store.loadRegistry({ fresh: true });
  const active = entries.filter((e) => e.active);
  let ok = 0;
  for (const e of active) {
    try {
      const img = await store.loadImage(e);
      console.log(`ok   ${e.id.padEnd(16)} ${String(img.bytes.length).padStart(8)} bytes  ${img.mime}`);
      ok++;
    } catch (err) {
      console.log(`FAIL ${e.id.padEnd(16)} ${err.code || err.message}`);
    }
  }
  console.log(`registry: ${entries.length} entries, ${active.length} active, version ${createLibrary(entries).version}; images readable: ${ok}/${active.length}`);
  if (ok !== active.length) process.exitCode = 1;
} else if (cmd === 'sync') {
  const [root] = rest;
  if (!root) { console.error('usage: sync <refs_root>'); process.exit(2); }
  const existing = new Set((await store.loadRegistry({ fresh: true })).map((e) => e.path));
  for (const e of REFERENCE_LIBRARY.filter((x) => !x.missing)) {
    if (existing.has(e.path)) continue;
    await store.putImage(e.path, await readFile(join(root, e.path)), undefined, { overwrite: true });
    console.log(`uploaded ${e.path}`);
  }
  // Blob's registry wins for references it already has (imports, disabled
  // flags); bundled references it lacks are added.
  const remote = await store.loadRegistry({ fresh: true });
  const merged = [...remote, ...REFERENCE_LIBRARY.filter((b) => !b.missing && !remote.some((r) => r.id === b.id))];
  await store.saveRegistry(merged);
  console.log(`registry written: ${merged.length} entries, version ${createLibrary(merged).version}`);
} else {
  console.error('commands: add, disable, enable, remove, list, verify, sync (see the header of this file)');
  process.exit(2);
}
