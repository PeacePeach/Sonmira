// Prepares the iOS app (Capacitor) for Xcode:   npm run ios
//
//   1. builds www/ (what ships inside the app),
//   2. copies it into the Xcode project (npx cap sync ios),
//   3. points the app at the hosted site, or at the bundled files.
//
// native/ios.json, overridable with SONMIRA_IOS_MODE / SONMIRA_APP_URL:
//   mode "hosted"   the app opens appUrl (the Vercel site), so web changes
//                   (Engine tuning, fixes) reach phones without a new build.
//                   Only an offline page ships inside the app.
//   mode "bundled"  the app's files ship inside the build and open offline;
//                   API calls go to appUrl. Web changes need a new build.
//
// Then: npx cap open ios → Xcode → pick your team → Product → Archive.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WWW = join(ROOT, 'www');
const conf = JSON.parse(readFileSync(join(ROOT, 'native/ios.json'), 'utf8'));
const mode = process.env.SONMIRA_IOS_MODE || conf.mode || 'hosted';
const appUrl = (process.env.SONMIRA_APP_URL || conf.appUrl || '').replace(/\/+$/, '');

if (!['hosted', 'bundled'].includes(mode)) throw new Error(`mode must be hosted or bundled, not ${mode}`);
if (!/^https:\/\/[^/]+$/.test(appUrl)) {
  console.error('Set the Sonmira site, e.g. SONMIRA_APP_URL=https://sonmira.example npm run ios (or appUrl in native/ios.json).');
  process.exit(1);
}

rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW, { recursive: true });
cpSync(join(ROOT, 'native/offline.html'), join(WWW, 'offline.html'));
writeFileSync(join(WWW, 'offline-config.js'), `window.SONMIRA_APP_URL = ${JSON.stringify(appUrl)};\n`);
if (mode === 'bundled') {
  for (const f of ['index.html', 'styles.css', 'manifest.webmanifest', 'assets', 'src']) cpSync(join(ROOT, f), join(WWW, f), { recursive: true });
  writeFileSync(join(WWW, 'src/app/native/config.js'), `// Written by scripts/ios.mjs (bundled build).\nexport const API_ORIGIN = ${JSON.stringify(appUrl)};\n`);
} else {
  // Capacitor needs an index.html; the hosted site replaces it at launch.
  cpSync(join(ROOT, 'native/offline.html'), join(WWW, 'index.html'));
}

execFileSync('npx', ['cap', 'sync', 'ios'], { cwd: ROOT, stdio: 'inherit' });

// The synced config is generated (git-ignored); add where the app opens.
const synced = join(ROOT, 'ios/App/App/capacitor.config.json');
const cfg = JSON.parse(readFileSync(synced, 'utf8'));
if (mode === 'hosted') cfg.server = { ...cfg.server, url: appUrl, errorPath: 'offline.html' };
writeFileSync(synced, JSON.stringify(cfg, null, 2) + '\n');
console.log(`\niOS app ready (${mode}: ${appUrl}). Next: npx cap open ios`);
