// Terms and Privacy as a sheet, so reading them from the paywall never
// leaves the screen underneath (or a take that's waiting to be painted).

import { h } from '../ui/dom.js';
import { DOCS, legalProse } from '../screens/legal.js';
import { openLayer } from './layer.js';

export function openLegalSheet(app, doc) {
  const d = DOCS[doc] || DOCS.privacy;
  const layer = openLayer(app, { label: d.title, title: d.title, cls: 'legal-sheet' });
  layer.body.append(
    h('div', { class: 'caps', style: 'margin-top:4px' }, `Last updated ${d.updated}`),
    h('div', { class: 'legal-sheet-prose' }, legalProse(d)));
  return layer;
}
