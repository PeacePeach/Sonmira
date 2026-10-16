// Words → subject matter. Text suggests a broad motif, never a literal
// illustration. Without usable words the painting is abstract. When a note
// names several motifs equally, the one mentioned first leads and the next
// is kept as `secondary`.

import { MOTIF_WORDS, countMatches, topMatches, firstMention } from './lexicon.js';

export const MOTIFS = ['water', 'sky', 'garden', 'landscape', 'interior', 'abstract'];
export const DEFAULT_MOTIF = 'abstract';

// allowed: motif labels the caller can accept (e.g. the app contract's list).
export function interpretMotif(text, allowed = MOTIFS) {
  const cats = MOTIFS.filter((m) => allowed.includes(m));
  const counts = countMatches(text, MOTIF_WORDS);
  const top = topMatches(counts, cats);
  if (!top.length) return { value: DEFAULT_MOTIF, source: 'default', secondary: null };
  const value = top.length === 1 ? top[0] : firstMention(text, MOTIF_WORDS, top);
  const rest = cats.filter((c) => c !== value && counts[c] > 0).sort((a, b) => counts[b] - counts[a]);
  return { value, source: 'note', secondary: rest[0] ?? null };
}
