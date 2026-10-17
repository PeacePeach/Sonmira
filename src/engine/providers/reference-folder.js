// SERVER ONLY: the reference folder in the repository, references/.
//
// The images ship with the deploy, next to the bundled registry
// (direct/references.js). An image in a family folder that the registry does
// not list yet joins that family's pool at start-up, so adding a reference is
// a commit and a deploy, with no code or list to edit:
//
//   references/resolved/R4/new-painting.jpg   → R4-lyrical-everyday
//   references/gathered/G2-splash-wash/x.png  → G2-splash-wash
//
// Any folder in the path named after a family (its full id or its code)
// assigns it. A bundled entry keeps its family, palette and content; a new
// image has no measured palette, so direct() uses the family's observed
// colour schemes for its colour line. Images outside a family folder are not
// eligible.

import { readdirSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFERENCE_LIBRARY } from '../direct/references.js';
import { FAMILIES } from '../direct/families.js';
import { createLibrary } from '../direct/library.js';

export const REFERENCE_DIR = fileURLToPath(new URL('../../../references/', import.meta.url));
const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const familyOf = (name) => FAMILIES[name] ? name : Object.keys(FAMILIES).find((id) => id.split('-')[0].toUpperCase() === name.toUpperCase()) || null;

function imagesUnder(root, rel = '') {
  const out = [];
  for (const d of readdirSync(join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...imagesUnder(root, p));
    else if (EXTS.has(extname(d.name).toLowerCase())) out.push(p);
  }
  return out;
}

// The bundled registry plus every new image in a family folder. Ids are the
// file name without extension (made safe for /api/reference); a name already
// taken gets the family code as a prefix.
export function folderRegistry(root = REFERENCE_DIR, registry = REFERENCE_LIBRARY) {
  if (!existsSync(root)) return registry;
  const known = new Set(registry.map((e) => e.path));
  const ids = new Set(registry.map((e) => e.id));
  const added = [];
  for (const path of imagesUnder(root).sort()) {
    if (known.has(path)) continue;
    const family = path.split('/').slice(0, -1).map(familyOf).filter(Boolean).pop();
    if (!family) continue;
    const stem = basename(path, extname(path)).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 48);
    let id = stem;
    if (ids.has(id)) id = `${family.split('-')[0]}_${stem}`;
    if (ids.has(id)) continue;
    ids.add(id);
    added.push({ id, family, path, active: true });
  }
  return added.length ? [...registry, ...added] : registry;
}

// True when the folder holds the images themselves (not only a README).
export const folderHasImages = (root = REFERENCE_DIR) => existsSync(root) && imagesUnder(root).length > 0;

// What /api/generate and /api/reference select from, read once per cold start.
export const FOLDER_REGISTRY = folderRegistry();
export const FOLDER_LIBRARY = createLibrary(FOLDER_REGISTRY);
