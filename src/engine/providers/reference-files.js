// SERVER ONLY: loads a selected reference image from the reference root
// ($SONMIRA_REFS_DIR or a tool's --refs), by its registry path.
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const MIME = { '.png': 'image/png', '.webp': 'image/webp' };

export const fileReferenceLoader = (root) => async (ref) => ({
  name: ref.path.split('/').pop(),
  mime: MIME[extname(ref.path).toLowerCase()] || 'image/jpeg',
  bytes: await readFile(join(root, ref.path)),
});
