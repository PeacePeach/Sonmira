// Emotion → colour family. Read from the note first; when the note is empty
// or says nothing emotional, take a gentle guess from the voice's register
// and loudness, and otherwise fall back to a neutral default.

import { EMOTION_WORDS, countMatches, topMatches } from './lexicon.js';

export const EMOTIONS = ['tender', 'bright', 'melancholic', 'intense'];
export const DEFAULT_EMOTION = 'tender';

export function emotionFromVoice(features) {
  const level = features?.level?.mean;
  const hue = features?.hue?.mean;
  if (level == null || !(features.activity?.voicedSec > 0.5)) return null;
  if (level > 0.6 && (features.pitch?.rangeSemitones ?? 0) > 8) return 'intense';
  if (hue < 150 && level > 0.35) return 'bright';
  if (hue > 205 && level < 0.45) return 'melancholic';
  return 'tender';
}

export function interpretEmotion(note, features) {
  const voice = emotionFromVoice(features);
  const top = topMatches(countMatches(note, EMOTION_WORDS), EMOTIONS);
  if (top.length === 1) return { value: top[0], source: 'note' };
  if (top.length > 1) return { value: top.includes(voice) ? voice : top[0], source: 'note' };
  if (voice) return { value: voice, source: 'voice' };
  return { value: DEFAULT_EMOTION, source: 'default' };
}
