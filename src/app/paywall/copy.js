// Words about paintings left, shared by the paywall, Sing and Settings.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Short balance, e.g. "2 free paintings left", "Today’s painting + 4". */
export function balanceLabel(s) {
  const extra = s.free + s.credits;
  if (s.dailyOpen) return extra ? `Today’s painting + ${extra}` : 'Today’s painting';
  if (s.free && s.credits) return `${plural(s.free, 'free painting', 'free paintings')} + ${s.credits}`;
  if (s.free) return `${plural(s.free, 'free painting', 'free paintings')} left`;
  if (s.credits) return `${plural(s.credits, 'painting', 'paintings')} left`;
  return s.subscribed ? 'More tomorrow' : 'None left';
}

/** What making this painting will use, shown before Create painting. */
export function usesLabel(s) {
  if (s.source === 'daily') return 'Uses today’s painting from Daily Ritual';
  if (s.source === 'free') return s.free === 1 ? 'Uses your last free painting' : `Uses 1 of your ${s.free} free paintings`;
  if (s.source === 'credits') return s.credits === 1 ? 'Uses your last painting' : `Uses 1 of your ${s.credits} paintings`;
  return '';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const shortDate = (t) => { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

/** "Renews November 16" / "Ends November 16" / "Ended October 2". */
export function renewalLabel(sub, now = Date.now()) {
  if (!sub) return '';
  if (sub.expiresAt <= now) return `Ended ${shortDate(sub.expiresAt)}`;
  return `${sub.willRenew ? 'Renews' : 'Ends'} ${shortDate(sub.expiresAt)}`;
}
