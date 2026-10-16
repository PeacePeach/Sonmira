// Check the lyrics reading's completeness judgement against labelled lines,
// with the real text model (no audio, no image). Each line costs one short
// text call (about $0.0005 with gpt-4.1-mini). The same cases run from the
// Preview dev panel (?dev → "Run lyrics evaluation").
//
//   node --env-file=.env.local tools/eval-lyrics.mjs [cases.json]
//   OPENAI_TEXT_MODEL=gpt-4.1 node --env-file=.env.local tools/eval-lyrics.mjs   # compare models
//
// Default cases: LYRICS_EVAL_CASES in src/engine/interpret/lyrics-eval.js.

import { readFileSync } from 'node:fs';
import { interpretLyrics } from '../src/engine/providers/openai-understand.js';
import { LYRICS_EVAL_CASES, scoreCase } from '../src/engine/interpret/lyrics-eval.js';

if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY is not set (use --env-file). Never commit it.'); process.exit(2); }
const cases = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : LYRICS_EVAL_CASES;
let ok = 0;
for (const c of cases) {
  try {
    const r = scoreCase(c, await interpretLyrics(c.text));
    ok += r.pass;
    const word = (b) => (b ? 'complete  ' : 'incomplete');
    console.log(`${r.pass ? 'ok  ' : 'MISS'} ${word(r.expected)} → ${word(r.actual)}  ${c.text}`);
    console.log(`       model: ${r.model.structure}, unfinished ${r.model.unfinished}, linked ${r.model.linked}, phraseComplete ${r.model.phraseComplete} (${r.model.confidence})${r.overridden ? ' [overridden by structure]' : ''} · ${r.model.reason}`);
  } catch (e) {
    console.log(`ERR  ${c.text}: ${e.code || e.message}`);
  }
}
console.log(`${ok}/${cases.length} match (${process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini'})`);
if (ok !== cases.length) process.exitCode = 1;
