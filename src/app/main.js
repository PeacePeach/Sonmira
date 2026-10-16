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

const SCREENS = { diary: mountDiary, sing: mountSing, detail: mountDetail, settings: mountSettings, legal: mountLegal };
const ENTER = { diary: 'enter-fade', sing: 'enter-modal', detail: 'enter-push', settings: 'enter-push', legal: 'enter-push' };

const root = document.getElementById('app');
const now = new Date();

export const app = {
  root,
  engine: null,
  settings: loadSettings(),
  storage: { persistent: true },
  dev: { enabled: new URLSearchParams(location.search).has('dev'), completeness: null, simulate: false },
  ui: { view: 'list', selDay: null, calY: now.getFullYear(), calM: now.getMonth() },
  entries: [],
  current: null,

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
  const [engine, storage] = await Promise.all([getEngine(), initStorage()]);
  app.engine = engine;
  app.storage = storage;
  try { app.entries = await listEntries(); }
  catch (e) { console.warn(e); app.storage = { persistent: false, loadFailed: true }; }
  app.navigate('diary');
  if (app.dev.enabled) (await import('./dev.js')).mountDevPanel(app);
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
