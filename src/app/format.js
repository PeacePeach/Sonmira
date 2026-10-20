export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar day as 'YYYY-MM-DD'. */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

/** 12 → "0:12", 75 → "1:15" */
export const clock = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };

/** "THURSDAY, OCTOBER 15" */
export const longDate = (k) => { const d = fromKey(k); return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`.toUpperCase(); };

/** 1760984520000 → "6:22 PM" (local time) */
export const timeOfDay = (ms) => { const d = new Date(ms); const h = d.getHours(); return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`; };

/** "TUESDAY, OCTOBER 20  ·  6:22 PM  ·  0:12": when it was made and how long it is, for share files. */
export const madeLine = (date, createdAt, durationSec) => [longDate(date), createdAt ? timeOfDay(createdAt) : null, durationSec ? clock(durationSec) : null].filter(Boolean).join('  ·  ');

/** "October 15" (+ ", 2025" when not this year) */
export const monthDay = (k) => {
  const d = fromKey(k);
  const y = d.getFullYear() !== new Date().getFullYear() ? `, ${d.getFullYear()}` : '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${y}`;
};
export const weekday = (k) => DAYS[fromKey(k).getDay()];
