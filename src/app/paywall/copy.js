// Words about paintings left, shared by the paywall, Sing and Settings.

// Every credit makes one painting, whichever kind it is, so people only ever
// see the total; which kind a painting uses stays the wallet's business.
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const total = (s) => s.ritual + s.free + s.credits;

/** Short balance, e.g. "12 paintings available", "None left". */
export function balanceLabel(s) {
  return total(s) ? `${plural(total(s), 'painting', 'paintings')} available` : 'None left';
}

/** What making this painting will use, shown before Create painting. */
export function usesLabel(s) {
  if (!s.source) return '';
  return total(s) === 1 ? 'Uses your last painting' : `Uses 1 of your ${total(s)} paintings`;
}

/** Settings → Available: every painting that can be made now, e.g. "0 paintings", "12 paintings". */
export function availableLabel(s) {
  return plural(total(s), 'painting', 'paintings');
}

/** Under Available, while a Daily Ritual credit is on its way: "+1 Daily Ritual credit tomorrow at 9:00 AM".
 *  The "when" part is held together so a narrow row breaks before it. */
export function nextCreditLabel(s, now = s.now ?? Date.now()) {
  return s.subscribed && s.ritualNextAt ? `+1 Daily Ritual credit ${whenLabel(s.ritualNextAt, now).replace(/ /g, '\u00a0')}` : '';
}

/** Settings → Daily Ritual: "Active", "Ends November 16" (auto-renew off), "Ended October 2". */
export function subscriptionLabel(sub, now = Date.now()) {
  if (!sub) return '';
  return sub.expiresAt > now && sub.willRenew ? 'Active' : renewalLabel(sub, now);
}

const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** "today at 3:15 PM", "tomorrow at 9:00 AM", "on November 16". */
export function whenLabel(t, now = Date.now()) {
  const days = Math.round((dayStart(t) - dayStart(now)) / 864e5);
  if (days <= 0) return `today at ${clock(t)}`;
  if (days === 1) return `tomorrow at ${clock(t)}`;
  return `on ${shortDate(t)}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const shortDate = (t) => { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

/** "Renews November 16" / "Ends November 16" / "Ended October 2". */
export function renewalLabel(sub, now = Date.now()) {
  if (!sub) return '';
  if (sub.expiresAt <= now) return `Ended ${shortDate(sub.expiresAt)}`;
  return `${sub.willRenew ? 'Renews' : 'Ends'} ${shortDate(sub.expiresAt)}`;
}
