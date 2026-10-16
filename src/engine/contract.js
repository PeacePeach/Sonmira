// Sonmira — shared generation contract (v1)
//
// This file is the only thing the app (Track A, src/app/) and the
// voice-to-watercolor engine (Track B, src/engine/) agree on.
// The app imports `getEngine()` from ./engines/index.js and talks to the
// returned object exclusively through the shapes below. Nothing in src/app/
// may import from analysis/, interpret/, render/ or a specific engine file.
//
// Changing this file is a cross-track decision: bump CONTRACT_VERSION and
// keep validators in sync.

export const CONTRACT_VERSION = 1;

export const COMPLETENESS = /** @type {const} */ (['loose', 'gathered', 'resolved']);
export const EMOTIONS = /** @type {const} */ (['tender', 'bright', 'melancholic', 'intense']);
export const MOTIFS = /** @type {const} */ (['water', 'sky', 'garden', 'landscape', 'abstract']);

/**
 * One pigment mark of the live / underlying wash. Coordinates are percentages
 * of the painting box; colour is OKLCH. The app renders these as soft blobs.
 * @typedef {Object} Stroke
 * @property {number} x  centre x, % (0–100)
 * @property {number} y  centre y, % (0–100)
 * @property {number} w  width, % of box width
 * @property {number} h  height, % of box width
 * @property {number} hue  OKLCH hue, degrees
 * @property {number} l  OKLCH lightness 0–1
 * @property {number} c  OKLCH chroma
 * @property {number} a  alpha 0–1
 * @property {number} rot  rotation, degrees
 * @property {string} br  CSS border-radius (organic shape)
 */

/**
 * Returned ~every 100 ms while recording; drives the live wash and the halo.
 * @typedef {Object} LiveSignal
 * @property {number} level  0–1 loudness for the halo
 * @property {number} hue    current smoothed hue (degrees) for the halo tint
 * @property {Stroke|null} stroke  a new wash mark to add, or null
 */

/**
 * Engine-owned summary of a take. Opaque to the app except for the fields
 * documented here; the app stores it with the entry so a later engine can
 * re-generate. Must be JSON-serialisable.
 * @typedef {Object} Analysis
 * @property {number} durationSec
 * @property {{ silent: boolean, tooShort: boolean }} flags
 *   silent: almost nothing audible; tooShort: under ~1.5 s of material.
 *   These are capture-quality hints only, never singing-quality scores.
 * @property {Stroke[]} wash  the wash accumulated during recording
 * @property {Object} [features]  engine-specific measurements (opaque)
 */

/**
 * @typedef {Object} GenerateRequest
 * @property {Analysis} analysis
 * @property {string} [note]          the user's optional note ('' if none)
 * @property {Blob|null} [audioBlob]  original recording, if the engine wants it
 * @property {{ completeness?: typeof COMPLETENESS[number] }} [overrides]
 *   developer-only; never set by user-facing UI
 */

/**
 * @typedef {{kind:'asset', src:string, focus?:string}
 *         | {kind:'image', blob:Blob, focus?:string}} Artwork
 *   asset: a URL relative to the app root (e.g. 'assets/art/scene-shore.png').
 *   image: generated pixels. focus is a CSS object-position for 3:2 crops.
 */

/**
 * @typedef {Object} Painting
 * @property {string} engineId
 * @property {number} contractVersion
 * @property {typeof COMPLETENESS[number]} completeness
 * @property {{label: typeof EMOTIONS[number], source: 'note'|'voice'|'default'}} emotion
 * @property {{label: typeof MOTIFS[number], source: 'note'|'voice'|'default'}} motif
 * @property {Artwork|null} artwork  null → the wash alone is the painting
 * @property {Stroke[]} wash
 * @property {{ voiceLabel: string, summary: string, dryingLine: string }} interpretation
 *   voiceLabel e.g. "Low, soft, steady" (descriptive, not a grade)
 *   summary    short caps-friendly line for the result screen
 *   dryingLine italic line shown while the painting appears
 */

/**
 * @typedef {Object} LiveSession
 * @property {(samples: Float32Array) => LiveSignal} push  time-domain frame (≈2048 samples)
 * @property {() => Analysis} finish
 */

/**
 * @typedef {Object} Engine
 * @property {string} id
 * @property {(opts: {sampleRate: number, maxSeconds: number}) => LiveSession} createLiveSession
 * @property {(req: GenerateRequest) => Promise<Painting>} generate
 *   Must always resolve with a usable Painting (fall back to neutral
 *   defaults when classification / transcription is unavailable).
 */

const fail = (m) => { throw new Error('contract: ' + m); };

/** @param {any} e @returns {Engine} */
export function validateEngine(e) {
  if (!e || typeof e.id !== 'string') fail('engine.id missing');
  if (typeof e.createLiveSession !== 'function') fail('engine.createLiveSession missing');
  if (typeof e.generate !== 'function') fail('engine.generate missing');
  return e;
}

/** @param {any} a @returns {Analysis} */
export function validateAnalysis(a) {
  if (!a || typeof a.durationSec !== 'number') fail('analysis.durationSec');
  if (!a.flags || typeof a.flags.silent !== 'boolean' || typeof a.flags.tooShort !== 'boolean') fail('analysis.flags');
  if (!Array.isArray(a.wash)) fail('analysis.wash');
  return a;
}

/** @param {any} p @returns {Painting} */
export function validatePainting(p) {
  if (!p || typeof p.engineId !== 'string') fail('painting.engineId');
  if (!COMPLETENESS.includes(p.completeness)) fail('painting.completeness ' + p.completeness);
  if (!p.emotion || !EMOTIONS.includes(p.emotion.label)) fail('painting.emotion');
  if (!p.motif || !MOTIFS.includes(p.motif.label)) fail('painting.motif');
  if (p.artwork !== null) {
    if (!p.artwork || !['asset', 'image'].includes(p.artwork.kind)) fail('painting.artwork.kind');
    if (p.artwork.kind === 'asset' && typeof p.artwork.src !== 'string') fail('painting.artwork.src');
  }
  if (!Array.isArray(p.wash)) fail('painting.wash');
  const i = p.interpretation;
  if (!i || typeof i.voiceLabel !== 'string' || typeof i.summary !== 'string' || typeof i.dryingLine !== 'string') fail('painting.interpretation');
  return p;
}
