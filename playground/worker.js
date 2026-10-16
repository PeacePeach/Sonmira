// Runs analysis + painting off the main thread so the page stays responsive.
// Uses the real engine modules unchanged.
import { analyzeSamples } from '../src/engine/analysis/index.js';
import { generatePainting } from '../src/engine/generate.js';
import { planPainting } from '../src/engine/plan.js';

self.onmessage = async ({ data }) => {
  const { id, op } = data;
  try {
    if (op === 'analyze') {
      const t = performance.now();
      const features = analyzeSamples(data.samples, data.sampleRate);
      self.postMessage({ id, ok: true, features, ms: performance.now() - t });
    } else if (op === 'plan') {
      const p = planPainting(data.opts);
      self.postMessage({ id, ok: true, spec: p.spec, prompt: p.direction.prompt, summary: p.summary });
    } else if (op === 'paint') {
      const t = performance.now();
      const g = await generatePainting(data.opts);
      const { image, ...meta } = g;
      self.postMessage({ id, ok: true, meta, image, ms: performance.now() - t }, [image.rgba.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack || err) });
  }
};
