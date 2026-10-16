// Contract conformance for any engine. Run: npm test
// Track B can point ENGINE_ID at its own engine: ENGINE_ID=real npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { getEngine } from '../src/engine/engines/index.js';
import { validateAnalysis, validatePainting, COMPLETENESS } from '../src/engine/contract.js';

const SR = 48000, N = 2048;
const engineId = process.env.ENGINE_ID || 'mock';

function tone(frames, { hz = 220, amp = 0.15, vibrato = 0 } = {}) {
  const out = []; let ph = 0;
  for (let f = 0; f < frames; f++) {
    const buf = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const fr = hz * (1 + vibrato * Math.sin((f * N + i) / SR * 5 * 2 * Math.PI));
      ph += (2 * Math.PI * fr) / SR;
      buf[i] = amp * (Math.sin(ph) + 0.4 * Math.sin(2 * ph));
    }
    out.push(buf);
  }
  return out;
}
const silence = (frames) => Array.from({ length: frames }, () => new Float32Array(N));
const noise = (frames, amp = 0.2) => Array.from({ length: frames }, () => Float32Array.from({ length: N }, () => (Math.random() * 2 - 1) * amp));

async function run(frames, note = '', overrides) {
  const engine = await getEngine(engineId);
  const s = engine.createLiveSession({ sampleRate: SR, maxSeconds: 15 });
  for (const f of frames) {
    const sig = s.push(f);
    assert.ok(sig.level >= 0 && sig.level <= 1);
    assert.equal(typeof sig.hue, 'number');
  }
  const analysis = validateAnalysis(s.finish());
  JSON.parse(JSON.stringify(analysis)); // must be serialisable
  const painting = validatePainting(await engine.generate({ analysis, note, audioBlob: null, overrides }));
  return { analysis, painting };
}

test('steady sustained tone produces a valid painting', async () => {
  const { analysis, painting } = await run(tone(60));
  assert.equal(analysis.flags.silent, false);
  assert.equal(analysis.flags.tooShort, false);
  assert.ok(painting.wash.length > 0);
});

test('silence is flagged and still yields a painting', async () => {
  const { analysis, painting } = await run(silence(40));
  assert.equal(analysis.flags.silent, true);
  assert.ok(COMPLETENESS.includes(painting.completeness));
});

test('very short take is flagged', async () => {
  const { analysis } = await run(tone(8));
  assert.equal(analysis.flags.tooShort, true);
});

test('noise does not crash', async () => { await run(noise(30)); });

test('note words steer motif and emotion', async () => {
  const { painting } = await run(tone(40), 'Rain on the window, missing you');
  assert.equal(painting.motif.label, 'water');
  assert.equal(painting.motif.source, 'note');
  assert.equal(painting.emotion.source, 'note');
});

test('developer override can force every completeness level', async () => {
  for (const c of COMPLETENESS) {
    const { painting } = await run(tone(30), '', { completeness: c });
    assert.equal(painting.completeness, c);
    assert.ok(painting.artwork);
  }
});
