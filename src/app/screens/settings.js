// Settings — functioning rows show a value and respond to taps; rows for
// features that don't exist yet say "Coming soon" and do nothing.

import { h, icons } from '../ui/dom.js';
import { LENGTHS } from '../settings.js';

export function mountSettings(app) {
  const lengthVal = h('span', { class: 'val' });
  const weekVal = h('span', { class: 'val' });
  const paint = () => {
    lengthVal.textContent = `${app.settings.maxSeconds} seconds`;
    weekVal.textContent = app.settings.weekStart === 1 ? 'Mon' : 'Sun';
  };

  const action = (label, val, onClick) => h('button', { class: 'row action', onClick }, h('span', {}, label), val);
  const link = (label, onClick) => h('button', { class: 'row action', onClick }, h('span', {}, label), icons.chevron());
  const soon = (label) => h('div', { class: 'row soon', 'aria-disabled': 'true' }, h('span', {}, label), h('span', { class: 'val' }, 'Coming soon'));

  const el = h('div', { class: 'settings', 'data-screen': 'settings' },
    h('div', { class: 'navrow' }, h('button', { class: 'icon-btn', 'aria-label': 'Back to diary', onClick: () => app.navigate('diary') }, icons.back()), h('div')),
    h('h1', {}, 'Settings'),
    h('div', { class: 'section' }, 'Diary'),
    h('div', { class: 'group' },
      action('Recording length', lengthVal, () => {
        const i = LENGTHS.indexOf(app.settings.maxSeconds);
        app.setSettings({ maxSeconds: LENGTHS[(i + 1) % LENGTHS.length] }); paint();
      }),
      action('Start day of week', weekVal, () => { app.setSettings({ weekStart: app.settings.weekStart ? 0 : 1 }); paint(); }),
      soon('Daily reminder'),
      soon('Diary lock'),
      soon('Backup / restore')),
    h('div', { class: 'section' }, 'About'),
    h('div', { class: 'group' },
      soon('Rate Sonmira'),
      link('Privacy policy', () => app.navigate('legal', { doc: 'privacy' })),
      link('Terms', () => app.navigate('legal', { doc: 'terms' }))),
    h('div', { class: 'foot' }, 'Recordings stay on this device.'));

  paint();
  return { el };
}
