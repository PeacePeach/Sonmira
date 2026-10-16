// App shell: state, navigation between screens, persistence glue.
// The only engine entry point is getEngine() — see src/engine/contract.js.

import { getEngine } from '../engine/engines/index.js';
import { h } from './ui/dom.js';
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
import { installApiFetch } from './native/fetch.js';

const SCREENS = { diary: mountDiary, sing: mountSing, detail: mountDetail, settings: mountSettings, legal: mountLegal };
const ENTER = { diary: 'enter-fade', sing: 'enter-modal', detail: 'enter-push', settings: 'enter-push', legal: 'enter-push' };

const root = document.getElementById('app');
const now = new Date();

export const app = {
  root,
  engine: null,
  settings: loadSettings(),
  storage: { persistent: true },
  // preview: the hosted preview link, where the microphone is not available,
  // so takes use the sample voice and the diary starts with example entries.
  dev: { enabled: new URLSearchParams(location.search).has('dev') || location.hash === '#dev', completeness: null, simulate: false, preview: !!window.SONMIRA_PREVIEW },
  ui: { view: 'list', selDay: null, calY: now.getFullYear(), calM: now.getMonth() },
  entries: [],
  current: null,
  billing: null,
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
    screen.el.classList.add('screen', ENTER[name]);
    root.append(screen.el);
    this.current = screen;
    if (prev) {
      prev.destroy?.();
      prev.el.classList.add('leave');
      setTimeout(() => prev.el.remove(), 220);
    }
  },

  setSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    if (!saveSettings(this.settings)) this.toast('Settings can’t be saved in this browser mode. They’ll reset when you leave.');
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
    this.entries = this.entries.filter((e) => e.id !== id);
  },

  toast(msg, ms = 4200) {
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    root.append(t);
    setTimeout(() => t.remove(), ms);
  },
};

async function boot() {
  // API calls carry the local day, and reach the hosted API from the bundled iOS build.
  installApiFetch();
  const [engine, storage] = await Promise.all([getEngine(), initStorage()]);
  app.engine = engine;
  app.storage = storage;
  app.billing = createBilling({ ask: (req) => askSimulator(app, req) });
  // A purchase that finishes while no paywall is open (an Ask to Buy approval).
  app.billing.onChange((ev) => {
    if (ev.type !== 'transaction' || !ev.product || app.paywallOpen) return;
    app.toast(ev.product.kind === 'subscription' ? 'Approved. Your Daily Ritual has begun.' : `Approved. ${ev.product.credits} paintings were added.`);
  });
  try { app.entries = await listEntries(); }
  catch (e) { console.warn(e); app.storage = { persistent: false, loadFailed: true }; }
  if (app.dev.preview) await seedPreview();
  app.navigate('diary');
  if (app.dev.enabled) (await import('./dev.js')).mountDevPanel(app);
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
