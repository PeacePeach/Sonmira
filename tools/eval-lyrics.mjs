// Check the lyrics reading's completeness judgement against labelled lines,
// with the real text model (no audio, no image). Each line costs one short
// text call (about $0.0005 with gpt-4.1-mini).
//
//   node --env-file=.env.local tools/eval-lyrics.mjs [cases.json]
//   OPENAI_TEXT_MODEL=gpt-4.1 node --env-file=.env.local tools/eval-lyrics.mjs   # compare models
//
// Default cases: test/fixtures/lyrics-completeness.json. A case passes when
// the gate's verdict (phraseVerdict + confidence bar) matches its label.

import { readFileSync } from 'node:fs';
import { interpretLyrics } from '../src/engine/providers/openai-understand.js';
import { phraseVerdict, GATE_CALIBRATION } from '../src/engine/interpret/lyrics.js';

if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY is not set (use --env-file). Never commit it.'); process.exit(2); }
const file = process.argv[2] || new URL('../test/fixtures/lyrics-completeness.json', import.meta.url);
const cases = JSON.parse(readFileSync(file, 'utf8'));
let ok = 0;
for (const c of cases) {
  try {
    const r = await interpretLyrics(c.text);
    const v = phraseVerdict(r);
    const complete = v.complete && r.completionConfidence >= GATE_CALIBRATION.minCompletion;
    const pass = complete === c.complete;
    ok += pass;
    console.log(`${pass ? 'ok  ' : 'MISS'} ${c.complete ? 'complete  ' : 'incomplete'} → ${complete ? 'complete  ' : 'incomplete'}  ${c.text}`);
    console.log(`       model: ${r.structure}, unfinished ${r.unfinished}, linked ${r.linked}, phraseComplete ${r.phraseComplete} (${r.completionConfidence})${v.overridden ? ' [overridden by structure]' : ''} · ${r.completionReason}`);
  } catch (e) {
    console.log(`ERR  ${c.text}: ${e.code || e.message}`);
  }
}
console.log(`${ok}/${cases.length} match (${process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini'})`);
if (ok !== cases.length) process.exitCode = 1;
