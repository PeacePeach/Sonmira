// User preferences (small, so localStorage). Every access is guarded: some
// private modes throw on localStorage.

const KEY = 'sonmira.settings';
const DEFAULTS = { weekStart: 0 /* 0 = Sunday, 1 = Monday */ };

/** Every recording stops by itself here (the person can finish sooner). Not a setting. */
export const MAX_SECONDS = 30;

export function loadSettings() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    delete s.maxSeconds; // the old Recording length setting
    if (s.weekStart !== 0 && s.weekStart !== 1) s.weekStart = 0;
    return s;
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}
