// Diary (home): chronological list of paintings, optional calendar filter.

import { h, icons } from '../ui/dom.js';
import { createPainting } from '../ui/painting.js';
import { clock, dayKey, monthDay, weekday, MONTHS } from '../format.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function mountDiary(app) {
  const scroll = h('div', { class: 'diary-scroll' });
  const toggle = h('button', { class: 'icon-btn', onClick: () => { app.ui.view = app.ui.view === 'list' ? 'calendar' : 'list'; app.ui.selDay = null; render(); } });
  const top = h('div', { class: 'diary-top' },
    h('div', { class: 'navrow' },
      h('div', { class: 'spacer44' }),
      h('span', { class: 'wordmark serif' }, 'Sonmira'),
      h('div', { style: 'display:flex;align-items:center' },
        toggle,
        h('button', { class: 'icon-btn', 'aria-label': 'Settings', onClick: () => app.navigate('settings') }, icons.dots()))));
  const fab = h('button', { class: 'fab', 'aria-label': 'Sing a new entry', onClick: () => app.startNewMemory() }, icons.plus());
  const el = h('div', { 'data-screen': 'diary' }, scroll, top, h('div', { class: 'fab-fade' }), fab);
  let paintings = [];

  function calendar() {
    const { calY, calM, selDay } = app.ui;
    const ws = app.settings.weekStart;
    const has = new Set(app.entries.map((e) => e.date));
    const today = dayKey();
    const first = (new Date(calY, calM, 1).getDay() - ws + 7) % 7;
    const dim = new Date(calY, calM + 1, 0).getDate(), pdim = new Date(calY, calM, 0).getDate();
    const total = Math.ceil((first + dim) / 7) * 7;
    const cells = [];
    for (let i = 0; i < total; i++) {
      const d = i - first + 1, inM = d >= 1 && d <= dim;
      const key = inM ? dayKey(new Date(calY, calM, d)) : null;
      const sel = key && key === selDay, isToday = key === today, hasE = key && has.has(key);
      const day = h('div', { class: 'cal-day', style: { background: sel ? '#1F1D1A' : isToday ? '#EFEAE1' : 'transparent', color: sel ? '#fff' : inM ? '#1F1D1A' : '#CFC9BF' } },
        h('span', {}, inM ? d : d < 1 ? pdim + d : d - dim),
        h('div', { class: 'dot', style: { background: hasE ? (sel ? '#fff' : '#1F1D1A') : 'transparent' } }));
      cells.push(hasE
        ? h('button', { class: 'cal-cell', 'aria-label': `${monthDay(key)}${sel ? ', selected' : ''}`, onClick: () => { app.ui.selDay = sel ? null : key; render(); } }, day)
        : h('div', { class: 'cal-cell', style: 'cursor:default' }, day));
    }
    const shift = (n) => { const d = new Date(calY, calM + n, 1); app.ui.calY = d.getFullYear(); app.ui.calM = d.getMonth(); render(); };
    return h('div', { class: 'cal' },
      h('div', { class: 'cal-head' },
        h('div', {}, h('span', { class: 'm serif' }, MONTHS[calM]), h('span', { class: 'y serif' }, calY)),
        h('div', { class: 'cal-nav' },
          h('button', { 'aria-label': 'Previous month', onClick: () => shift(-1) }, icons.prev()),
          h('button', { 'aria-label': 'Next month', onClick: () => shift(1) }, icons.next()))),
      h('div', { class: 'cal-grid' }, [0, 1, 2, 3, 4, 5, 6].map((i) => h('div', { class: 'cal-wd' }, WD[(i + ws) % 7])), cells));
  }

  function entryCard(e) {
    const p = createPainting({ ratio: '32', strokes: e.painting?.wash, artwork: e.painting?.artwork, lazy: true });
    paintings.push(p);
    return h('button', { class: 'entry', 'data-entry': e.id, onClick: () => app.navigate('detail', { id: e.id }) },
      p.el,
      h('div', { class: 'entry-meta' },
        h('span', { class: 'cap' + (e.note ? '' : ' untitled') }, e.note || 'Untitled'),
        h('span', { class: 'dur tabular' }, clock(e.durationSec))));
  }

  function render() {
    const y = scroll.scrollTop;
    paintings.forEach((p) => p.destroy()); paintings = [];
    toggle.replaceChildren(app.ui.view === 'list' ? icons.calendar() : icons.list());
    toggle.setAttribute('aria-label', app.ui.view === 'list' ? 'Show calendar' : 'Show list');

    const sel = app.ui.view === 'calendar' && app.ui.selDay;
    const list = app.sortedEntries().filter((e) => !sel || e.date === sel);
    const groups = [];
    for (const e of list) {
      let g = groups[groups.length - 1];
      if (!g || g.date !== e.date) groups.push((g = { date: e.date, items: [] }));
      g.items.push(e);
    }
    scroll.replaceChildren(...[
      app.ui.view === 'calendar' ? calendar() : null,
      app.dev.preview && app.entries.some((e) => e.id.startsWith('sample-')) && !sel
        ? h('p', { class: 'notice' }, 'The first entries are examples. Tap + to sing your own.') : null,
      !app.storage.persistent ? h('p', { class: 'notice' }, app.storage.loadFailed
        ? 'Your diary couldn’t be opened on this device. New entries may not be kept.'
        : 'This browser isn’t keeping data (private browsing?). Entries will disappear when you close it.') : null,
      ...groups.map((g) => h('section', {},
        h('div', { class: 'group-head' }, h('span', { class: 'md serif' }, monthDay(g.date)), h('span', { class: 'wd serif' }, weekday(g.date))),
        g.items.map(entryCard))),
      list.length ? null : h('div', { class: 'empty serif' }, sel ? `Nothing sung on ${monthDay(sel)}.` : 'Nothing here yet. Tap + and sing.'),
    ].filter(Boolean));
    scroll.scrollTop = y;
  }

  render();
  return { el, update: render, destroy() { paintings.forEach((p) => p.destroy()); } };
}
