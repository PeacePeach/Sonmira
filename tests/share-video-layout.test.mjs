// The share video's composition (src/app/share/card.js drawVideoCard), after
// Han's design: sentence and mark centred above the painting, the waveform
// under it, the title and full date centred below; nothing cut off, inside
// the safe area. Drawn on a recording stand-in for canvas.
// tests/e2e/save-photos.mjs checks the real MP4 against the sheet's preview.
// Run: npm test
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
const { madeLine, timeOfDay } = await import('../src/app/format.js');
const MADE = new Date(2026, 9, 20, 18, 22).getTime();

test('the made line: day, time and length', () => {
  assert.equal(timeOfDay(new Date(2026, 9, 20, 0, 5).getTime()), '12:05 AM');
  assert.equal(timeOfDay(MADE), '6:22 PM');
  assert.equal(madeLine('2026-10-20', MADE, 12), 'TUESDAY, OCTOBER 20  ·  6:22 PM  ·  0:12');
  assert.equal(madeLine('2026-10-20', null, 12), 'TUESDAY, OCTOBER 20  ·  0:12', 'older entries without a time');
});

const NOTES = { none: '', short: 'Rain', long: 'Rain on the window again, the kettle, and the long slow afternoon after it all' };
const ART = { portrait: [1024, 1280], square: [1024, 1024], landscape: [1536, 1024], tall: [1024, 1820] };

for (const [noteKind, note] of Object.entries(NOTES)) for (const [artKind, [w, h]] of Object.entries(ART)) {
  test(`video: the design's layout (${noteKind} title, ${artKind} art)`, () => {
    const log = { texts: [], rects: [] };
    const { art, wave, text } = drawVideoCard(fakeCtx(log), { painting: {}, img: { naturalWidth: w, naturalHeight: h }, note, date: '2026-10-20', createdAt: MADE, durationSec: 12 });
    const at = (s) => log.texts.find((t) => t.t === s);
    assert.ok(at(STORY_LINE).y < art.y && at('Sonmira').y < art.y, 'the sentence and the mark sit above the painting');
    assert.ok(at(STORY_LINE).y < at('Sonmira').y, 'the sentence, then the mark');
    const dateLine = at('TUESDAY, OCTOBER 20, 2026');
    assert.ok(dateLine, 'the full date, with the year');
    assert.ok(dateLine.y > wave.y + wave.h, 'the date sits under the waveform');
    if (note) {
      const lines = log.texts.filter((t) => note.startsWith(t.t.replace(/…$/, '')) && t.t !== STORY_LINE);
      assert.ok(lines.length, 'the title is in the video');
      for (const l of lines) assert.ok(l.y > wave.y + wave.h && l.y < dateLine.y, 'the title sits between the waveform and the date');
    }
    for (const t of log.texts) if (t.t !== 'Sonmira') assert.equal(t.x, VIDEO.W / 2, `"${t.t}" is centred`); // the wordmark is centred with its mark
    assert.ok(wave.y > art.y + art.h, 'the waveform is under the painting');
    assert.ok(text.top >= VIDEO_SAFE.top, 'clear of the top bar');
    assert.ok(text.bottom <= VIDEO.H - VIDEO_SAFE.bottom, `the last line (y ${Math.round(text.bottom)}) is clear of the bottom bar`);
    assert.ok(art.x >= VIDEO_SAFE.side - 1 && art.x + art.w <= VIDEO.W - VIDEO_SAFE.side + 1, 'not cropped at the sides');
    assert.ok(Math.abs(art.w / art.h - w / h) < 0.01, 'the artwork keeps its shape');
    assert.ok(art.h > 500, `the artwork stays large (${Math.round(art.h)} px)`);
  });
}

test('video: a 4:5 painting lands where the design puts it', () => {
  const { art } = drawVideoCard(fakeCtx({ texts: [], rects: [] }), { painting: {}, img: { naturalWidth: 1024, naturalHeight: 1280 }, note: '不懂爱恨情仇煎熬的我们', date: '2026-10-20' });
  assert.deepEqual([Math.round(art.x), Math.round(art.w)], [120, 840]);
});
