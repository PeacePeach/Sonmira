// App shell: state, navigation between screens, persistence glue.
// The only engine entry point is getEngine() — see src/engine/contract.js.

import { getEngine } from '../engine/engines/index.js';
import { h } from './ui/dom.js';
import { showBanner } from './ui/banner.js';
import { initStorage, listEntries, putEntry, removeEntry } from './storage.js';
import { loadSettings, saveSettings } from './settings.js';
import { mountDiary } from './screens/diary.js';
import { mountSing } from './screens/sing.js';
import { mountDetail } from './screens/detail.js';
import { mountSettings } from './screens/settings.js';
import { mountLegal } from './screens/legal.js';
import { createBilling } from './billing/index.js';
import { askSimulator } from './paywall/simulator.js';
import { openPaywall } from './paywall/paywall.js';
import { installApiClient } from './protect/client.js';
import { askInviteCode } from './protect/invite-sheet.js';
import { createDrafts } from './drafts/index.js';
import { installApiFetch } from './native/fetch.js';
import { mountAccount } from './screens/account.js';
import { mountAccountDelete } from './screens/account-delete.js';
import { createAccountForDevice } from './account/setup.js';
import { localStorageBox } from './account/index.js';
import { wantsUxPreview, previewBilling, previewBadge } from './ux-preview.js';
import { isNativeIOS } from './native/platform.js';
import { releaseArtwork } from './ui/painting.js';
import { bakeGrain } from './ui/wash.js';

const SCREENS = { diary: mountDiary, sing: mountSing, detail: mountDetail, settings: mountSettings, legal: mountLegal, account: mountAccount, accountDelete: mountAccountDelete };
const ENTER = { diary: 'enter-fade', sing: 'enter-modal', detail: 'enter-push', settings: 'enter-push', legal: 'enter-push', account: 'enter-push', accountDelete: 'enter-push' };

const root = document.getElementById('app');
const now = new Date();
// ?ux-preview on localhost or a Vercel preview only (ux-preview.js): mock engine, sample voice, nothing counted.
const uxPreview = wantsUxPreview({ search: location.search, hostname: location.hostname, native: isNativeIOS() });

export const app = {
  root,
  engine: null,
  settings: loadSettings(),
  storage: { persistent: true },
  // preview: the hosted preview link, where the microphone is not available,
  // so takes use the sample voice and the diary starts with example entries.
  dev: { enabled: new URLSearchParams(location.search).has('dev') || location.hash === '#dev', completeness: null, simulate: uxPreview, preview: !!window.SONMIRA_PREVIEW, uxPreview },
  ui: { view: 'list', selDay: null, calY: now.getFullYear(), calM: now.getMonth() },
  entries: [],
  current: null,
  billing: null,
  account: null,
  paywallOpen: null,

  /** Go to Sing if a painting can be made; otherwise offer more, then go on. */
  startNewMemory() {
    if (this.billing.status().canCreate) return this.navigate('sing');
    openPaywall(this, { from: 'diary', onContinue: () => this.navigate('sing') });
  },

  navigate(name, params = {}) {
    const prev = this.current;
    const screen = SCREENS[name](this, params);
    screen.name = name;
    screen.el.classList.add('screen');
    root.append(screen.el);
    // From a diary card, the detail page grows out of the card instead.
    if (!(params.from && screen.enterFrom?.(params.from))) screen.el.classList.add(ENTER[name]);
    this.current = screen;
    if (prev) {
      prev.destroy?.();
      prev.el.classList.add('leave');
      setTimeout(() => prev.el.remove(), 220);
    }
  },

  setSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    if (!saveSettings(this.settings)) this.toast('Settings can’t be saved in this browser mode. They’ll reset when you leave.', { kind: 'warning' });
  },

  sortedEntries() {
    return [...this.entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
  },

  async addEntry(entry) {
    await putEntry(entry); // throws on failure — caller keeps the result screen
    this.entries.push(entry);
  },

  async updateEntry(entry) {
    await putEntry(entry);
    this.entries = this.entries.map((e) => (e.id === entry.id ? entry : e));
  },

  async deleteEntry(id) {
    await removeEntry(id);
    releaseArtwork(this.entries.find((e) => e.id === id)?.painting?.artwork);
    this.entries = this.entries.filter((e) => e.id !== id);
  },

  // A banner (ui/banner.js). opts: { kind: 'success' | 'info' | 'warning' | 'error', ms }.
  toast(msg, opts = {}) {
    return showBanner(root, msg, typeof opts === 'number' ? { ms: opts } : opts);
  },
};

async function boot() {
  // API calls carry the local day, and reach the hosted API from the bundled iOS build.
  installApiFetch();
  const [engine, storage] = await Promise.all([getEngine(uxPreview ? 'mock' : undefined), initStorage()]);
  app.engine = engine;
  app.storage = storage;
  // Paid, billing and sign-in requests carry the install token (server/protect),
  // for the device's one id: the account id (deviceIdentity below).
  let identified;
  const identity = new Promise((r) => { identified = r; });
  app.api = installApiClient({
    askInvite: (o) => askInviteCode(app, o),
    installId: async () => (await identity).id,
    accountToken: () => localStorageBox.read()?.token ?? null,
  });
  app.billing = createBilling({ ask: (req) => askSimulator(app, req) });
  if (uxPreview) { app.billing = previewBilling(app.billing); root.append(previewBadge()); }
  app.account = createAccountForDevice(app, await deviceIdentity(app.billing));
  identified(app.account);
  await app.billing.syncWeb(app.account.id);
  followAccount(app);
  // A purchase that finishes while no paywall is open (an Ask to Buy approval).
  app.billing.onChange((ev) => {
    if (ev.type !== 'transaction' || !ev.product || app.paywallOpen) return;
    app.toast(ev.product.kind === 'subscription' ? 'Approved. Your Daily Ritual has begun.' : `Approved. ${ev.product.credits} paintings were added.`, { kind: 'success' });
  });
  try { app.entries = await listEntries(); }
  catch (e) { console.warn(e); app.storage = { persistent: false, loadFailed: true }; }
  // Paintings not kept yet, outside the diary.
  app.drafts = createDrafts();
  await app.drafts.init();
  await app.drafts.reconcile(app.entries.map((e) => e.id)).catch(() => {});
  if (app.dev.preview) await seedPreview();
  app.navigate('diary');
  // The paper grain, baked once after the diary has come in (ui/wash.js).
  setTimeout(() => { const w = Math.max(402, Math.ceil(root.clientWidth)); bakeGrain(w, Math.ceil(w * 1.25)); }, 700);
  // Apple or the server may have ended the session while the app was closed.
  app.account.check().then((r) => { if (r === 'signedOut') app.toast('You’re no longer signed in with Apple. Your diary is still here.'); });
  if (app.dev.enabled) (await import('./dev.js')).mountDevPanel(app);
}

// One id per device for the guard, the paintings ledger and the account. In
// the iOS app it is the Keychain id (StoreKit's appAccountToken, kept across
// reinstalls by iCloud Keychain), and new guest ids are UUIDs like it; in a
// browser it starts as the guard's existing install id.
async function deviceIdentity(billing) {
  const keychain = await billing.accountId().catch(() => null);
  const seed = keychain ?? safeGet('sonmira.install');
  return {
    box: { read: () => localStorageBox.read() ?? (seed ? { id: seed, token: null, user: null, since: null } : null), write: (v) => localStorageBox.write(v) },
    newId: keychain ? () => globalThis.crypto.randomUUID() : undefined,
  };
}
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

// Sign-in (a returning account), sign-out and deletion change the id: the
// Keychain and the ledger follow it (the API client already does).
function followAccount(app) {
  const follow = async () => {
    const id = app.account.id;
    try {
      const keychain = await app.billing.accountId();
      if (keychain && keychain !== id) await app.billing.setAccountId(id);
    } catch (e) { console.warn('[sonmira] account id not followed', e); }
  };
  app.account.onChange(follow);
  follow();
}

async function seedPreview() {
  try {
    if (app.entries.length || localStorage.getItem('sonmira.previewSeeded')) return;
    localStorage.setItem('sonmira.previewSeeded', '1');
    await (await import('./dev.js')).seed(app);
  } catch (e) { console.warn('[sonmira] preview seed skipped', e); }
}

// On desktop, scale the 402×874 canvas down to fit short browser windows.
function fitStage() {
  const framed = getComputedStyle(root).borderRadius !== '0px';
  const k = framed ? Math.min(1, (innerHeight - 48) / 874, (innerWidth - 48) / 402) : 1;
  root.style.transform = k < 1 ? `scale(${k.toFixed(3)})` : '';
  root.parentElement.style.minHeight = framed && k < 1 ? '0' : '';
  root.parentElement.style.height = framed && k < 1 ? '100vh' : '';
  root.parentElement.style.padding = framed && k < 1 ? '0' : '';
}
addEventListener('resize', fitStage);
fitStage();

boot();
window.sonmira = app; // handy in the console during prototyping
