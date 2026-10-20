// Words about paintings left, shared by the paywall, Sing and Settings.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ritualCredits = (n) => plural(n, 'Daily Ritual credit', 'Daily Ritual credits');

/** Short balance, e.g. "2 free paintings left", "3 Daily Ritual credits + 4". */
export function balanceLabel(s, now = s.now ?? Date.now()) {
  const extra = s.free + s.credits;
  if (s.ritual) return extra ? `${ritualCredits(s.ritual)} + ${extra}` : ritualCredits(s.ritual);
  if (s.free && s.credits) return `${plural(s.free, 'free painting', 'free paintings')} + ${s.credits}`;
  if (s.free) return `${plural(s.free, 'free painting', 'free paintings')} left`;
  if (s.credits) return `${plural(s.credits, 'painting', 'paintings')} left`;
  if (s.subscribed && s.ritualNextAt) return `Next credit ${whenLabel(s.ritualNextAt, now)}`;
  return 'None left';
}

/** What making this painting will use, shown before Create painting. */
export function usesLabel(s) {
  if (s.source === 'daily') return s.ritual === 1 ? 'Uses your last Daily Ritual credit' : `Uses 1 of your ${s.ritual} Daily Ritual credits`;
  if (s.source === 'free') return s.free === 1 ? 'Uses your last free painting' : `Uses 1 of your ${s.free} free paintings`;
  if (s.source === 'credits') return s.credits === 1 ? 'Uses your last painting' : `Uses 1 of your ${s.credits} paintings`;
  return '';
}

/** Daily Ritual credits for Settings: "12 of 30 · next tomorrow at 9:00 AM", "30 of 30", "4 · kept until November 16". */
export function ritualLabel(s, now = s.now ?? Date.now()) {
  if (s.ritualExpiresAt) return `${s.ritual} · kept until ${shortDate(s.ritualExpiresAt)}`;
  const count = `${s.ritual} of ${s.ritualCap}`;
  return s.ritualNextAt ? `${count} · next ${whenLabel(s.ritualNextAt, now)}` : count;
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
