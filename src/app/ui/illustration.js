// The watercolor illustrations for quiet moments (empty diary, errors,
// waiting, a new beginning). One painted series on the same paper and
// pigments; multiply lets the paper melt into whatever is behind it.
//
//   drops    the shared one: empty diary, paintings added, Daily Ritual begins
//   mic-off  microphone off, missing or busy

import { h } from './dom.js';

/** @param {string} name  @param {'s'|'m'} size */
export const illustration = (name, size = 'm') =>
  h('img', { class: `illo illo-${size}`, src: `assets/illustrations/${name}.jpg`, alt: '', 'aria-hidden': 'true', decoding: 'async', 'data-illo': name });
