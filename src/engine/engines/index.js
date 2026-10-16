// Engine registry. The app calls getEngine() and nothing else.
// Switch implementations with ?engine=<id> or by changing DEFAULT_ENGINE —
// no UI component needs to change.
//
// ai    real audio analysis → OpenAI reference-guided painting (server)
// real  real audio analysis → procedural watercolour renderer (offline)
// mock  stand-in paintings from the bundled set

import { validateEngine } from '../contract.js';
import { createMockEngine } from './mock.js';

const DEFAULT_ENGINE = 'ai';

const REGISTRY = {
  mock: async () => createMockEngine(),
  real: async () => (await import('./real.js')).createRealEngine(),
  ai: async () => (await import('./ai.js')).createAIEngine(),
};

let cached = null;

/** @returns {Promise<import('../contract.js').Engine>} */
export async function getEngine(id) {
  const fromUrl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('engine') : null;
  const want = id || fromUrl || DEFAULT_ENGINE;
  if (cached && cached.key === want) return cached.engine;
  let engine;
  try {
    engine = validateEngine(await (REGISTRY[want] || REGISTRY[DEFAULT_ENGINE])());
  } catch (err) {
    // A missing or broken engine must never break the app.
    console.warn(`[sonmira] engine "${want}" unavailable, using mock:`, err);
    engine = validateEngine(createMockEngine());
  }
  cached = { key: want, engine };
  return engine;
}
