// The share video's composition (src/app/share/card.js drawVideoCard): every
// word sits above the artwork, and everything stays inside the safe area, so
// a player's controls and playhead never cover the text. Drawn on a
// recording stand-in for canvas. tests/e2e/save-photos.mjs checks the real
// MP4 against the sheet's preview. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

// A canvas 2D context that records text and shapes; text is ~0.5em per character.
function fakeCtx(log) {
  const state = { font: '20px x' };
  const target = {
    texts: log.texts, rects: log.rects,
    measureText: (t) => ({ width: String(t).length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] || 20) * 0.5 }),
    fillText: (t, x, y) => log.texts.push({ t, x, y }),
    roundRect: (x, y, w, h) => log.rects.push({ x, y, w, h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  return new Proxy(target, {
    get: (o, k) => (k in o ? o[k] : k === 'font' ? state.font : () => {}),
    set: (o, k, v) => { if (k === 'font') state.font = v; return true; },
  });
}
globalThis.document = { createElement: () => ({ getContext: () => fakeCtx({ texts: [], rects: [] }) }) };
globalThis.Path2D = class {};

const { drawVideoCard, VIDEO, VIDEO_SAFE, STORY_LINE } = await import('../src/app/share/card.js');

const NOTES = { none: '', short: 'Rain', long: 'Rain on the window again, the kettle, and the long slow afternoon after it all' };
const ART = { portrait: [1024, 1280], square: [1024, 1024], landscape: [1536, 1024], tall: [1024, 1820] };

for (const [noteKind, note] of Object.entries(NOTES)) for (const [artKind, [w, h]] of Object.entries(ART)) {
  test(`video: text above the artwork, inside the safe area (${noteKind} title, ${artKind} art)`, () => {
    const log = { texts: [], rects: [] };
    const { art, wave, text } = drawVideoCard(fakeCtx(log), { painting: {}, img: { naturalWidth: w, naturalHeight: h }, note, date: '2026-10-20', durationSec: 12 });
    assert.ok(log.texts.some((t) => t.t === STORY_LINE), 'the sentence is in the video');
    assert.ok(log.texts.some((t) => t.t === 'Sonmira'), 'the wordmark is in the video');
    if (note) assert.ok(log.texts.some((t) => note.startsWith(t.t.replace(/…$/, ''))), 'the title is in the video');
    for (const t of log.texts) assert.ok(t.y < art.y, `"${t.t}" (y ${t.y}) sits above the artwork (y ${art.y})`);
    assert.ok(text.top >= VIDEO_SAFE.top, 'clear of the top bar');
    assert.ok(wave.y + wave.h <= VIDEO.H - VIDEO_SAFE.bottom, 'the waveform ends above the player controls');
    assert.ok(art.x >= VIDEO_SAFE.side - 1 && art.x + art.w <= VIDEO.W - VIDEO_SAFE.side + 1, 'not cropped at the sides');
    assert.ok(Math.abs(art.w / art.h - w / h) < 0.01, 'the artwork keeps its shape');
    assert.ok(art.h > 500, `the artwork stays large (${Math.round(art.h)} px)`);
  });
}
