// Labelled lines for checking the lyrics reading's completeness judgement
// against the real text model (tools/eval-lyrics.mjs and the Preview dev
// panel). Dev-only; nothing in the app uses these.

import { phraseVerdict, GATE_CALIBRATION } from './lyrics.js';

export const LYRICS_EVAL_CASES = [
  { text: '遥远的夜空月亮月亮下面', complete: false, note: 'real case A: repetition, ends on a localizer' },
  { text: '月亮，咖啡，石头', complete: false, note: 'real case B: unrelated noun list' },
  { text: '星星 河流 窗户', complete: false, note: 'noun list, related-sounding' },
  { text: '月亮 夜空 星星', complete: false, note: 'semantically related nouns only' },
  { text: '在那条长长的路', complete: false, note: 'unfinished prepositional phrase' },
  { text: '当我走过', complete: false, note: 'unfinished subordinate clause' },
  { text: 'the night the night sky under', complete: false, note: 'restart and dangling preposition' },
  { text: 'moon, coffee, stone', complete: false, note: 'noun list' },
  { text: 'when I was walking down the', complete: false, note: 'cut mid-phrase' },
  { text: '月光洒在海面上', complete: true, note: 'short clause' },
  { text: '海边的一盏孤灯', complete: true, note: 'bound image phrase, no verb' },
  { text: '我想你', complete: true, note: 'very short clause' },
  { text: '遥远的夜空挂着一轮明月', complete: true, note: 'complete version of case A' },
  { text: 'I miss you tonight', complete: true, note: 'short clause' },
  { text: 'a lonely boat on the evening river', complete: true, note: 'bound image phrase' },
  { text: 'you are my sunshine', complete: true, note: 'a line from a song; the recorded phrase is complete' },
];

// One case: the gate's completeness verdict on the model's reading, against
// the label. Same rule as the gate (phraseVerdict + confidence bar).
export function scoreCase(c, reading) {
  const v = phraseVerdict(reading);
  const actual = v.complete && reading.completionConfidence >= GATE_CALIBRATION.minCompletion;
  return {
    text: c.text, note: c.note, expected: c.complete, actual, pass: actual === c.complete,
    model: { structure: reading.structure, unfinished: reading.unfinished, linked: reading.linked, missing: reading.missing,
      phraseComplete: reading.phraseComplete, confidence: reading.completionConfidence, reason: reading.completionReason },
    overridden: v.overridden,
  };
}
