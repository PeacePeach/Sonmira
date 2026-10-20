// Sonmira icons: one registry, drawn from Lucide (https://lucide.dev, ISC License,
// lucide-static 0.460.0). Every icon in the app goes through icon(); no raw SVG
// elsewhere. The rules are in docs/icons.md.
//
//   icon('share')                          20 px, inherits the button's color
//   icon('plus', { size: 'lg', tone: 'inverse' })
//   icon('privacy', { tone: 'muted' })     leading icon in a Settings row
//   icon('play', { label: 'Playing' })     only when the icon itself carries meaning

const SVG_NS = 'http://www.w3.org/2000/svg';

// Rendered size in px. 'md' is the default; 'lg' is for the primary action of a
// screen (the + and the microphone); 'sm' for small trailing marks.
export const SIZES = { sm: 16, md: 20, lg: 24 };

// The line stays 1.5 px on screen at every size (Lucide draws on a 24 grid).
export const STROKE = 1.5;

// Semantic colors, mapped to tokens in styles.css (--icon-*). No tone = currentColor.
export const TONES = ['default', 'muted', 'subtle', 'disabled', 'inverse'];

// name: [lucide name, inner markup]
const GLYPHS = {
  back: ['chevron-left', '<path d="m15 18-6-6 6-6"/>'],
  forward: ['chevron-right', '<path d="m9 18 6-6-6-6"/>'],
  close: ['x', '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'],
  check: ['check', '<path d="M20 6 9 17l-5-5"/>'],
  share: ['share', '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>'],
  calendar: ['calendar', '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>'],
  diary: ['gallery-vertical-end', '<path d="M7 2h10"/><path d="M5 6h14"/><rect width="18" height="12" x="3" y="10" rx="2"/>'],
  more: ['ellipsis', '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'],
  plus: ['plus', '<path d="M5 12h14"/><path d="M12 5v14"/>'],
  mic: ['mic', '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>'],
  play: ['play', '<polygon points="6 3 20 12 6 21 6 3"/>'],
  pause: ['pause', '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>'],
  recordingLength: ['timer', '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>'],
  weekStart: ['calendar-days', '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>'],
  reminder: ['bell', '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'],
  lock: ['lock', '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'],
  backup: ['archive-restore', '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h2"/><path d="M20 8v11a2 2 0 0 1-2 2h-2"/><path d="m9 15 3-3 3 3"/><path d="M12 12v9"/>'],
  paintings: ['palette', '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>'],
  dailyRitual: ['sunrise', '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>'],
  morePaintings: ['circle-plus', '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>'],
  restore: ['rotate-ccw', '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'],
  rate: ['star', '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>'],
  privacy: ['shield', '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'],
  terms: ['file-text', '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'],
  rename: ['pencil', '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'],
  account: ['user-round', '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>'],
};

export const ICON_NAMES = Object.keys(GLYPHS);
export const lucideName = (name) => GLYPHS[name]?.[0];

/**
 * @param {keyof typeof GLYPHS} name
 * @param {{ size?: 'sm'|'md'|'lg', tone?: string, label?: string, class?: string }} [opts]
 *   label: give it only when the icon stands alone without a labelled button
 *   around it; otherwise the icon is decorative and hidden from screen readers.
 */
export function icon(name, { size = 'md', tone, label, class: cls } = {}) {
  const glyph = GLYPHS[name];
  if (!glyph) throw new Error(`[sonmira] unknown icon "${name}"`);
  const px = SIZES[size] ?? SIZES.md;
  const el = document.createElementNS(SVG_NS, 'svg');
  const attrs = {
    width: px, height: px, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': +(STROKE * 24 / px).toFixed(3), 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    class: ['icon', tone && tone !== 'default' ? `icon-${tone}` : null, cls].filter(Boolean).join(' '),
    'data-icon': name, focusable: 'false',
  };
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (label) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); }
  else el.setAttribute('aria-hidden', 'true');
  el.innerHTML = glyph[1];
  return el;
}
