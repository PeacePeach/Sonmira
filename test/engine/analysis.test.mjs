import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, analyzeSamples, FrameAnalyzer } from '../../src/engine/analysis/index.js';
import { voice, scenes, SR } from './synth.js';

test('pitch detection is within 1% across the singing range', () => {
  for (const sr of [16000, 44100]) {
    for (const hz of [90, 147, 220, 440, 880]) {
      const x = voice([{ hz, sec: 0.3 }], { sr, vibratoSt: 0 });
      const { hz: got } = detectPitch(x.subarray(2000, 2000 + 2048), sr);
      assert.ok(Math.abs(got - hz) / hz < 0.01, `${hz} Hz at ${sr}: got ${got}`);
    }
  }
});

test('features are measurements, not scores', () => {
  const f = analyzeSamples(scenes.steadyPhrase(), SR);
  assert.equal(f.kind, 'signal-measurements');
  const keys = JSON.stringify(f);
  for (const banned of ['score', 'accuracy', 'quality', 'rhythm']) assert.ok(!keys.includes(banned), banned);
});

test('a connected phrase reads as sustained and continuous', () => {
  const f = analyzeSamples(scenes.steadyPhrase(), SR);
  assert.ok(Math.abs(f.durationSec - 6.4) < 0.15);
  assert.equal(f.pauses.count, 0);
  assert.ok(f.activity.voicedSec > 5.5);
  assert.ok(f.pitch.continuity > 0.8);
  assert.ok(f.pitch.rangeSemitones > 3 && f.pitch.rangeSemitones < 8);
});

test('gaps are counted as pauses', () => {
  const f = analyzeSamples(scenes.brokenPhrase(), SR);
  assert.equal(f.pauses.count, 4);
  assert.ok(f.pauses.longestSec >= 1.0);
});

test('leaping pitch has low continuity and a wide range', () => {
  const f = analyzeSamples(scenes.leaping(), SR);
  assert.ok(f.pitch.continuity < 0.4);
  assert.ok(f.pitch.rangeSemitones > 15);
});

test('silence and noise have no pitch', () => {
  assert.equal(analyzeSamples(scenes.silence(), SR).pitch, null);
  assert.equal(analyzeSamples(scenes.silence(), SR).activity.soundingSec, 0);
  assert.equal(analyzeSamples(scenes.noise(), SR).pitch, null);
});

test('low voices are cool, high voices warm', () => {
  const low = analyzeSamples(voice([{ hz: 110, sec: 2 }]), SR).hue.mean;
  const high = analyzeSamples(voice([{ hz: 660, sec: 2 }]), SR).hue.mean;
  assert.ok(low > 230 && high < 100, `${low} ${high}`);
});

test('a 2048-sample snapshot at 48 kHz analyses in well under 5 ms', () => {
  const a = new FrameAnalyzer(48000);
  const buf = voice([{ hz: 220, sec: 0.05 }], { sr: 48000 }).subarray(0, 2048);
  for (let i = 0; i < 20; i++) a.addFrame(buf);
  const t = performance.now();
  for (let i = 0; i < 200; i++) a.addFrame(buf);
  const ms = (performance.now() - t) / 200;
  assert.ok(ms < 2, `${ms} ms`);
});
