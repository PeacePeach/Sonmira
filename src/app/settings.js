// User preferences (small, so localStorage). Every access is guarded: some
// private modes throw on localStorage.

const KEY = 'sonmira.settings';
const DEFAULTS = { maxSeconds: 15, weekStart: 0 /* 0 = Sunday, 1 = Monday */ };

export const LENGTHS = [15, 30];

export function loadSettings() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    if (!LENGTHS.includes(s.maxSeconds)) s.maxSeconds = DEFAULTS.maxSeconds;
    if (s.weekStart !== 0 && s.weekStart !== 1) s.weekStart = 0;
    return s;
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}
