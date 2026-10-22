# Reference admin portal

A password-protected page for adding and archiving watercolor reference
images without code changes, PRs or redeploys.

- Page: `/admin/references/` (static, `admin/references/index.html`)
- API: `/api/reference?admin=1&action=…` (`server/reference-admin-api.js`, served by `api/reference.js`, because the Hobby plan allows 12 functions and Sonmira already has 12)
- Storage logic: `src/engine/providers/reference-admin.js`

## Turning it on

Set `SONMIRA_ADMIN_PASSWORD` (12+ characters) in Vercel → Project → Settings →
Environment Variables, for the environment(s) where the portal should work,
then redeploy that environment once. Without it the API answers 404 and the
page shows "not enabled". The deployment also needs Blob credentials
(`BLOB_READ_WRITE_TOKEN`), which the reference store already uses.

## How it fits the engine

Nothing existing is migrated or rewritten. The 22 originals stay in
`src/engine/direct/references.js`; images dropped into `references/` in the
Blob store are still discovered as before. The portal adds an overlay in the
same private Blob store, under `reference-admin/<namespace>/`:

| path | meaning |
| --- | --- |
| `images/<tier>/<family code or any>/<id>.<ext>` | an added reference |
| `archived/<id>.json` | marker: the id is out of selection |
| `meta/<id>.json` | portal-only details (original name, size, note, sha256) |
| `ids/<id>` | id claim, created with `allowOverwrite: false` (atomic) |
| `audit/<time>-<rand>.json` | one record per upload, archive, restore |

`registryFor` (reference-store.js) applies the overlay to the registry
`/api/generate` already selects from: an added image joins its tier (and
family) exactly like a discovered upload, an archived id becomes inactive.
Tier draw, recent-five avoidance, Resolved looks and rolling-three motifs,
prompts and palettes are unchanged. An empty overlay returns the registry
object itself, so the library version and every selection stay identical.

The namespace is `production` on Production and `preview` on every Preview
(`SONMIRA_REFERENCE_ADMIN_NS` overrides), so testing on a Preview never
changes what Production paints.

## Rules

- Ids follow the existing `<tier>_NN` convention (`resolved_15`,
  `gathered_06`, …), numbered after every id the tier has ever had.
- Uploads: JPEG, PNG or WebP by their bytes, at most 4 MB, short side ≥ 256
  px, long side ≤ 8192 px, no exact duplicates of a portal upload.
- "Delete" is archive: the image is never removed and can be restored. A tier
  or a family always keeps one active reference. Existing paintings store
  their own image and do not depend on the reference.
- Added references have no measured palette (like images dropped into
  `references/`): direct() colours them from the drawn family, and the image
  itself is sent as the style reference.
- Changes reach generation within about 30 s (the registry cache).

## Recovery

- Undo an archive: Restore in the portal.
- Turn the whole overlay off: set `SONMIRA_REFERENCE_OVERLAY=0` and redeploy;
  generation goes back to bundled + discovered references. Stored files stay.
- The audit log lists every change with time, id and reason.

## Security

Server-side password check (constant time, throttled), HttpOnly +
SameSite=Strict + Secure session cookie scoped to `/api/reference`,
signed with a key derived from the password (changing it signs every session
out). Every POST needs the `x-sonmira-admin` header, which a cross-site form
cannot send. Images are streamed by id; no Blob URL, path or token reaches
the browser. The page is not part of the iOS bundle.
