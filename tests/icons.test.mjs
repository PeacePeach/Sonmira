// The icon registry: names, sizes, a constant 1.5 px line, and no stray SVG icons.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { ICON_NAMES, SIZES, STROKE, lucideName, icon } from '../src/app/ui/icons.js';

// Just enough DOM for icon() to build an element.
class El {
  constructor() { this.attrs = {}; this.innerHTML = ''; }
  setAttribute(k, v) { this.attrs[k] = v; }
}
globalThis.document = { createElementNS: () => new El() };

test('every name maps to a Lucide icon', () => {
  assert.ok(ICON_NAMES.length > 0);
  for (const n of ICON_NAMES) assert.match(lucideName(n), /^[a-z0-9-]+$/, n);
});

test('sizes are 16 / 20 / 24 with 20 as the default', () => {
  assert.deepEqual(SIZES, { sm: 16, md: 20, lg: 24 });
  assert.equal(icon('share').attrs.width, '20');
});

test('the line is 1.5 px on screen at every size', () => {
  for (const [size, px] of Object.entries(SIZES)) {
    const el = icon('close', { size });
    assert.equal(el.attrs.viewBox, '0 0 24 24');
    assert.ok(Math.abs(Number(el.attrs['stroke-width']) * px / 24 - STROKE) < 0.01, size);
  }
});

test('icons are hidden from screen readers unless given a label', () => {
  assert.equal(icon('share').attrs['aria-hidden'], 'true');
  const labelled = icon('play', { label: 'Play' });
  assert.equal(labelled.attrs.role, 'img');
  assert.equal(labelled.attrs['aria-label'], 'Play');
  assert.equal(labelled.attrs['aria-hidden'], undefined);
});

test('tones become classes backed by tokens', async () => {
  assert.equal(icon('privacy', { tone: 'muted' }).attrs.class, 'icon icon-muted');
  assert.equal(icon('privacy').attrs.class, 'icon');
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  for (const t of ['muted', 'subtle', 'disabled', 'inverse']) assert.match(css, new RegExp(`\\.icon-${t} \\{ color: var\\(--icon-${t}\\)`));
});

test('unknown names fail loudly', () => {
  assert.throws(() => icon('nope'), /unknown icon/);
});

test('no icon SVG markup outside the registry', async () => {
  const root = new URL('../src/app/', import.meta.url);
  const files = (await readdir(root, { recursive: true })).filter((f) => f.endsWith('.js') && !f.endsWith('icons.js'));
  for (const f of files) {
    const src = await readFile(new URL(f, root), 'utf8');
    assert.doesNotMatch(src, /<svg[^>]*viewBox="0 0 \d+ \d+"/, `${f} draws its own icon; use icon() from ui/icons.js`);
  }
});
