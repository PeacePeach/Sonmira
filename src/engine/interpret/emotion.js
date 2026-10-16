// Emotion → colour mood. Read only from words the person chose to give (the
// note, or later a transcript they consented to). Without words it stays on
// a neutral default: the voice alone is not used to guess how someone feels.
// The label steers pigments and temperature; it is not a diagnosis.

import { EMOTION_WORDS, countMatches, topMatches, firstMention } from './lexicon.js';

export const EMOTIONS = ['tender', 'bright', 'melancholic', 'intense'];
export const DEFAULT_EMOTION = 'tender';

export function interpretEmotion(text) {
  const top = topMatches(countMatches(text, EMOTION_WORDS), EMOTIONS);
  if (!top.length) return { value: DEFAULT_EMOTION, source: 'default' };
  return { value: top.length === 1 ? top[0] : firstMention(text, EMOTION_WORDS, top), source: 'note' };
}
