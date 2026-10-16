// Motif library. Each motif is an original composition described as layered
// elements with a role. The same composition is used at every tier; the
// style (paint/style.js) decides how much of each role becomes visible and
// how crisply it is painted:
//   ground     big washes that set the light (always present)
//   structure  the main masses: horizon, hills, clouds, foliage, wall
//   focal      the thing the eye lands on: figures, trees, a vase, a sun
//   detail     small marks that make it legible: ripples, birds, petals
//   accent     darkest darks / strongest notes (scaled by value contrast)
//
// Coordinates: x is a fraction of width, y a fraction of height; widths of
// lines are fractions of width. A = height / width of the sheet.
//
// Every element is generated here from simple geometry and a seed; no image
// data from the references is used.

import { blob, ellipse, rect, band, ridge, conifer, figure, hull, curve, ribbon } from './shapes.js';

const wash = (role, pts, color, alpha, o = {}) => ({ kind: 'wash', role, pts, color, alpha, ...o });
const line = (role, pts, color, alpha, width, o = {}) => ({ kind: 'line', role, pts, color, alpha, width, ...o });
const dots = (role, list, color, alpha, o = {}) => ({ kind: 'dots', role, dots: list, color, alpha, ...o });
const lift = (role, list, amount, o = {}) => ({ kind: 'lift', role, dots: list, amount, ...o });

const down = (from, to, k0 = 1, k1 = 0) => (x, y) => (y <= from ? k0 : y >= to ? k1 : k0 + ((y - from) / (to - from)) * (k1 - k0));
const pick = (r, list) => list[Math.floor(r() * list.length)];

function waterMotif(r, A) {
  const hz = 0.4 + r() * 0.07, shore = hz + 0.2 + r() * 0.06, right = r() < 0.5;
  const els = [
    wash('ground', rect(-0.05, -0.05, 1.05, hz + 0.02), 'sky', 0.55, { fade: down(0, hz + 0.02, 1, 0.25), soft: 2, minBlur: 12 }),
    wash('ground', band(hz - 0.12, hz + 0.01, r, 0.01), 'light', 0.5, { soft: 3 }),
    wash('ground', band(hz, 1.05, r, 0.004), 'water', 0.42, { fade: down(hz, 1, 0.9, 0.35), soft: 1.5 }),
  ];
  for (let i = 0; i < 3; i++) {
    const cx = 0.15 + r() * 0.7, cy = 0.08 + r() * (hz - 0.2), ry = 0.05 + r() * 0.04;
    els.push(wash('structure', blob(cx, cy, 0.16 + r() * 0.12, ry, r, 6, 0.3), pick(r, ['sky', 'shadow', 'light']), 0.22 + r() * 0.12, { fade: (x, y) => 0.55 + 0.45 * Math.min(1, Math.max(0, (y - cy + ry) / (2 * ry))), soft: 2.5 }));
  }
  // distant headland
  const hx0 = right ? 0.45 + r() * 0.15 : -0.05, hx1 = right ? 1.05 : 0.4 + r() * 0.15;
  els.push(wash('structure', ridge(hz, 0.022, r, { x0: hx0, x1: hx1, bottom: hz + 0.006, freq: 2 }), 'deep', 0.5, { soft: 0.6 }));
  els.push(wash('accent', ridge(hz + 0.002, 0.008, r, { x0: hx0 + 0.04 * (right ? 1 : 0), x1: hx1 - 0.04 * (right ? 0 : 1), bottom: hz + 0.006, freq: 3 }), 'shadow', 0.45, { soft: 0.5 }));
  // sea body darker toward the horizon, wet sand foreground with a curving waterline
  els.push(wash('structure', band(hz + 0.004, hz + 0.09, r, 0.003), 'water', 0.45, { fade: down(hz, hz + 0.09, 1, 0.3), soft: 1 }));
  const wl = curve([[-0.05, shore + 0.05], [0.3, shore], [0.65, shore + 0.03], [1.05, shore - 0.04]]);
  els.push(wash('structure', [...wl, [1.05, 1.05], [-0.05, 1.05]], 'earth', 0.42, { fade: down(shore, 1, 0.5, 1), soft: 1.2 }));
  els.push(line('detail', wl.map(([x, y]) => [x, y - 0.006]), 'water', 0.35, 0.006, { dry: 0.35 }));
  // ripples
  for (let i = 0; i < 9; i++) {
    const y = hz + 0.03 + r() * (shore - hz - 0.04), x = r() * 0.8 + 0.05, len = 0.05 + r() * 0.15;
    els.push(line('detail', [[x, y], [x + len * 0.5, y + 0.002], [x + len, y]], pick(r, ['deep', 'water']), 0.3, 0.003 + r() * 0.003, { dry: 0.4 }));
  }
  // figures at the waterline, with reflections
  const n = 1 + Math.floor(r() * 3), fx = 0.3 + r() * 0.4;
  for (let i = 0; i < n; i++) {
    const x = fx + (i - (n - 1) / 2) * (0.035 + r() * 0.02), foot = shore + 0.035 + r() * 0.015, h = 0.09 + r() * 0.025;
    const f = figure(x, foot, h, A, (r() - 0.5) * 0.4);
    els.push(wash('focal', f.body, i === 0 ? 'shadow' : 'deep', 0.85, { soft: 0.25, edge: 0.6 }));
    els.push(dots('focal', [[f.head[0], f.head[1], f.head[2]]], 'shadow', 0.85, { soft: 0.25 }));
    els.push(wash('detail', [[x - 0.008, foot + 0.004], [x + 0.008, foot + 0.004], [x + 0.004, foot + h * 0.8], [x - 0.004, foot + h * 0.8]], 'shadow', 0.3, { fade: down(foot, foot + h * 0.8, 1, 0), soft: 0.8 }));
  }
  const sparks = Array.from({ length: 26 }, () => [0.1 + r() * 0.8, hz + 0.02 + r() * (shore - hz), 0.0015 + r() * 0.003]);
  els.push(lift('detail', sparks, 0.75));
  return { elements: els, focus: [fx, shore], main: 'water', flow: 'horizontal' };
}

function skyMotif(r, A) {
  const hz = 0.76 + r() * 0.06, sx = 0.25 + r() * 0.5, sy = 0.2 + r() * 0.12;
  const els = [
    wash('ground', rect(-0.05, -0.05, 1.05, hz + 0.02), 'sky', 0.6, { fade: down(0, hz, 1, 0.2), soft: 2 }),
    wash('ground', ellipse(sx, sy + 0.1, 0.5, 0.32), 'light', 0.5, { soft: 4, minBlur: 45 }),
  ];
  // cloud banks: shadowed undersides, paper-white tops
  for (let i = 0; i < 4; i++) {
    const cx = 0.1 + r() * 0.8, cy = 0.3 + r() * (hz - 0.42), rx = 0.18 + r() * 0.16, ry = 0.05 + r() * 0.05;
    els.push(wash('structure', blob(cx, cy, rx, ry, r, 9, 0.28, 40), pick(r, ['shadow', 'deep', 'sky']), 0.28 + r() * 0.1, { fade: (x, y) => 0.15 + 0.85 * Math.min(1, Math.max(0, (y - cy + ry * 0.6) / (ry * 0.9))), soft: 1.6, edge: 1.2 }));
  }
  els.push(dots('focal', [[sx, sy, 0.05 + r() * 0.025]], 'warm', 0.55, { soft: 1.5, edge: 0 }));
  // low land with small trees
  els.push(wash('structure', ridge(hz, 0.012, r, { freq: 1.5 }), 'foliage', 0.55, { soft: 0.6 }));
  els.push(wash('accent', ridge(hz + 0.012, 0.006, r, { freq: 3 }), 'shadow', 0.5, { soft: 0.6 }));
  for (let i = 0; i < 6; i++) {
    const x = 0.05 + r() * 0.9, h = 0.02 + r() * 0.025;
    els.push(wash('detail', blob(x, hz - h * 0.45, 0.008 + r() * 0.006, h * 0.55, r, 5, 0.15, 14), 'deep', 0.6, { soft: 0.4 }));
  }
  // birds
  const bx = 0.2 + r() * 0.5, by = 0.25 + r() * 0.2;
  for (let i = 0; i < 5; i++) {
    const x = bx + r() * 0.25, y = by + r() * 0.1, s = 0.012 + r() * 0.01;
    els.push(line('detail', [[x - s, y - s * 0.4], [x - s * 0.4, y - s * 0.1], [x, y + s * 0.15], [x + s * 0.4, y - s * 0.1], [x + s, y - s * 0.5]], 'shadow', 0.7, 0.0025));
  }
  return { elements: els, focus: [sx, sy], main: 'sky', flow: 'horizontal' };
}

function gardenMotif(r, A) {
  const els = [
    wash('ground', rect(-0.05, -0.05, 1.05, 1.05), 'light', 0.38, { fade: down(0, 1, 1, 0.4), soft: 3 }),
    wash('ground', band(0.66, 1.05, r, 0.02), 'foliage', 0.4, { soft: 2 }),
  ];
  // path into depth
  const path = curve([[0.55 + r() * 0.1, 1.05], [0.45, 0.85], [0.52, 0.72], [0.48, 0.66]]);
  els.push(wash('structure', ribbon(path, 0.32, 0.03), 'light', 0.5, { soft: 1.2 }));
  // foliage masses behind and trunks
  for (let i = 0; i < 6; i++) {
    const cx = (i + 0.5) / 6 + (r() - 0.5) * 0.08, cy = 0.22 + r() * 0.28;
    els.push(wash('structure', blob(cx, cy, 0.14 + r() * 0.08, 0.1 + r() * 0.06, r, 8, 0.3), pick(r, ['foliage', 'foliage', 'water']), 0.32 + r() * 0.15, { soft: 1.6 }));
    els.push(line('structure', [[cx + (r() - 0.5) * 0.04, cy], [cx + (r() - 0.5) * 0.03, 0.62 + r() * 0.06]], 'earth', 0.45, 0.008 + r() * 0.006, { taper: [0.5, 1] }));
  }
  els.push(wash('accent', band(0.6, 0.67, r, 0.015), 'shadow', 0.35, { soft: 2 }));
  // flower clusters in the foreground
  const fx = 0.3 + r() * 0.4;
  for (let c = 0; c < 3; c++) {
    const cx = fx + (c - 1) * (0.18 + r() * 0.06), cy = 0.74 + r() * 0.12;
    els.push(wash('focal', blob(cx, cy + 0.03, 0.07, 0.035, r, 6, 0.3), 'foliage', 0.5, { soft: 0.8 }));
    const petals = [];
    for (let i = 0; i < 11; i++) petals.push([cx + (r() - 0.5) * 0.14, cy + (r() - 0.5) * 0.08, 0.012 + r() * 0.012]);
    els.push(dots('focal', petals, c === 1 ? 'warm' : pick(r, ['warm', 'light', 'water']), 0.8, { soft: 0.4 }));
    els.push(dots('detail', petals.map(([x, y, s]) => [x, y, s * 0.3]), 'deep', 0.5, { soft: 0.2 }));
    for (let i = 0; i < 5; i++) {
      const [x, y] = petals[i];
      els.push(line('detail', [[x, y + 0.01], [x + (r() - 0.5) * 0.02, y + 0.06]], 'foliage', 0.6, 0.0025));
    }
  }
  const leaves = Array.from({ length: 30 }, () => [r(), 0.12 + r() * 0.5, 0.004 + r() * 0.006]);
  els.push(dots('detail', leaves, 'foliage', 0.55, { soft: 0.3 }));
  els.push(lift('detail', Array.from({ length: 14 }, () => [r(), 0.2 + r() * 0.4, 0.008 + r() * 0.012]), 0.55));
  return { elements: els, focus: [fx, 0.78], main: 'foliage', flow: 'vertical' };
}

function landscapeMotif(r, A) {
  const els = [
    wash('ground', rect(-0.05, -0.05, 1.05, 0.6), 'sky', 0.45, { fade: down(0, 0.5, 1, 0.2), soft: 2.5 }),
    wash('ground', ellipse(0.5, 0.42, 0.7, 0.2), 'light', 0.4, { soft: 4, minBlur: 45 }),
  ];
  els.push(wash('structure', ridge(0.36 + r() * 0.04, 0.07, r, { freq: 1.2 }), 'sky', 0.4, { soft: 1.2 }));
  els.push(wash('structure', ridge(0.48 + r() * 0.04, 0.06, r, { freq: 1.6 }), 'deep', 0.38, { soft: 1 }));
  els.push(wash('structure', ridge(0.62 + r() * 0.04, 0.05, r, { freq: 1 }), 'foliage', 0.45, { soft: 1 }));
  els.push(wash('ground', band(0.72, 1.05, r, 0.01), 'earth', 0.32, { soft: 2 }));
  // river ribbon winding to the valley
  const river = curve([[0.35 + r() * 0.2, 1.05], [0.6, 0.88], [0.42, 0.78], [0.55, 0.68]]);
  els.push(wash('structure', ribbon(river, 0.22, 0.015), 'water', 0.5, { soft: 0.9 }));
  // conifer groups on the near slope
  const gx = r() < 0.5 ? 0.12 + r() * 0.15 : 0.62 + r() * 0.15;
  for (let i = 0; i < 7; i++) {
    const x = gx + (r() - 0.5) * 0.3, base = 0.66 + r() * 0.14, h = 0.08 + r() * 0.08;
    els.push(wash('focal', conifer(x, base, h * 0.42, h, r), pick(r, ['shadow', 'foliage', 'deep']), 0.75, { soft: 0.4 }));
    els.push(wash('detail', [[x, base], [x + h * 0.9, base + 0.006], [x + h * 0.9, base + 0.016], [x, base + 0.01]], 'shadow', 0.22, { soft: 0.8 }));
  }
  // a small house by the river
  const hx = 0.55 + (r() - 0.5) * 0.2, hy = 0.74;
  els.push(wash('detail', rect(hx - 0.025, hy - 0.022, hx + 0.025, hy), 'light', 0.6, { soft: 0.3 }));
  els.push(wash('detail', [[hx - 0.032, hy - 0.02], [hx, hy - 0.045], [hx + 0.032, hy - 0.02]], 'accent', 0.8, { soft: 0.3 }));
  els.push(wash('accent', ridge(0.665, 0.01, r, { freq: 2, bottom: 0.69 }), 'shadow', 0.3, { soft: 1 }));
  return { elements: els, focus: [gx, 0.7], main: 'deep', flow: 'vertical' };
}

function interiorMotif(r, A) {
  const wx0 = 0.2 + r() * 0.12, wx1 = wx0 + 0.42 + r() * 0.1, wy0 = 0.12 + r() * 0.05, wy1 = 0.56 + r() * 0.04, table = 0.7 + r() * 0.04;
  const els = [
    // wall with the window left open (even-odd fill of two rings)
    wash('ground', null, 'earth', 0.32, { rings: [rect(-0.05, -0.05, 1.05, table), rect(wx0, wy0, wx1, wy1)], soft: 1.5 }),
    wash('ground', rect(wx0, wy0, wx1, wy1), 'sky', 0.4, { fade: down(wy0, wy1, 1, 0.4), soft: 0.8 }),
    wash('structure', ridge(wy1 - 0.1, 0.03, r, { x0: wx0, x1: wx1, bottom: wy1, freq: 2 }), 'foliage', 0.45, { soft: 0.8 }),
    wash('structure', rect(-0.05, table, 1.05, 1.05), 'warm', 0.4, { soft: 1 }),
    wash('accent', rect(-0.05, table, 1.05, table + 0.012), 'shadow', 0.45, { soft: 0.6 }),
  ];
  // window frame: four sides + cross bar
  const fw = 0.012;
  for (const pts of [rect(wx0 - fw, wy0 - fw, wx1 + fw, wy0), rect(wx0 - fw, wy1, wx1 + fw, wy1 + fw * 1.4), rect(wx0 - fw, wy0, wx0, wy1), rect(wx1, wy0, wx1 + fw, wy1), rect((wx0 + wx1) / 2 - fw / 2, wy0, (wx0 + wx1) / 2 + fw / 2, wy1)])
    els.push(wash('structure', pts, 'shadow', 0.5, { soft: 0.3 }));
  // light falling in on the wall and table
  els.push(lift('structure', [[wx1 + 0.12, table + 0.08, 0.1]], 0.35, { soft: 6 }));
  // curtain folds
  for (let i = 0; i < 4; i++) {
    const x = wx1 + 0.02 + i * 0.022;
    els.push(line('detail', [[x, wy0 - 0.02], [x + (r() - 0.5) * 0.01, wy1 + 0.06]], 'deep', 0.25, 0.006, { dry: 0.2 }));
  }
  // vase with flowers on the table
  const vx = 0.36 + r() * 0.3, vh = 0.15 + r() * 0.04;
  els.push(wash('focal', blob(vx, table - vh * 0.42, 0.06, vh * 0.48, r, 3, 0.06, 30), 'deep', 0.7, { soft: 0.3 }));
  els.push(wash('focal', rect(vx - 0.022, table - vh, vx + 0.022, table - vh * 0.75), 'deep', 0.7, { soft: 0.3 }));
  els.push(wash('detail', [[vx + 0.05, table - 0.004], [vx + 0.2, table + 0.02], [vx + 0.18, table + 0.04], [vx + 0.03, table + 0.012]], 'shadow', 0.3, { soft: 1 }));
  els.push(lift('detail', [[vx - 0.025, table - vh * 0.5, 0.008]], 0.7));
  const blooms = Array.from({ length: 10 }, () => [vx + (r() - 0.5) * 0.18, table - vh - 0.05 - r() * 0.1, 0.012 + r() * 0.012]);
  for (const [x, y] of blooms.slice(0, 6)) els.push(line('detail', [[vx + (r() - 0.5) * 0.02, table - vh], [x, y]], 'foliage', 0.6, 0.003));
  els.push(dots('focal', blooms, pick(r, ['accent', 'warm']), 0.7, { soft: 0.5 }));
  return { elements: els, focus: [vx, table - vh * 0.6], main: 'earth', flow: 'vertical' };
}

function abstractMotif(r, A) {
  const els = [
    wash('ground', rect(-0.05, -0.05, 1.05, 1.05), pick(r, ['light', 'sky']), 0.3, { soft: 4 }),
  ];
  const cx = 0.35 + r() * 0.3, cy = 0.42 + r() * 0.16;
  els.push(wash('structure', ellipse(cx, cy, 0.3, 0.3 / A), 'water', 0.42, { soft: 1 }));
  els.push(wash('structure', ellipse(cx + (r() - 0.5) * 0.4, cy - 0.15 - r() * 0.08, 0.16, 0.16 / A), 'warm', 0.45, { soft: 1 }));
  els.push(wash('structure', band(0.74 + r() * 0.05, 0.84 + r() * 0.04, r, 0.006), 'earth', 0.38, { soft: 1 }));
  els.push(wash('accent', ellipse(cx + 0.12, cy + 0.1, 0.05, 0.05 / A), 'shadow', 0.7, { soft: 0.4 }));
  els.push(line('focal', ellipse(cx, cy, 0.23, 0.23 / A, 72).concat([[cx + 0.23, cy]]), 'deep', 0.6, 0.004));
  for (let i = 0; i < 3; i++) {
    const y = 0.16 + i * 0.03;
    els.push(line('detail', [[0.12, y], [0.12 + 0.25 + r() * 0.2, y]], 'deep', 0.5, 0.003));
  }
  const row = Array.from({ length: 7 }, (_, i) => [0.62 + i * 0.04, 0.88, 0.006]);
  els.push(dots('detail', row, 'accent', 0.7, { soft: 0.3 }));
  return { elements: els, focus: [cx, cy], main: 'water', flow: 'radial' };
}

export const MOTIF_BUILDERS = {
  water: waterMotif, sky: skyMotif, garden: gardenMotif,
  landscape: landscapeMotif, interior: interiorMotif, abstract: abstractMotif,
};
export const ALL_MOTIFS = Object.keys(MOTIF_BUILDERS);
