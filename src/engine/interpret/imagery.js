// Sung imagery, grounded in the transcript (Han, 21 Oct: the Concrete
// Imagery Floor). What counts as concrete imagery is the lyric reading's own
// semantic judgement (openai-understand.js `sungImagery`: any visually
// depictable thing the words sing, however unusual: a kite, a whale, a
// lighthouse, an old house; never a feeling or an abstract idea). Nothing
// here keeps a vocabulary. This only checks each item against the
// transcript: its quote must be words the transcript actually contains, so
// an image the reading imagined or added never counts.
//
//   groundedImagery(reading, transcriptText) → [{ motif, quote }]

// Latin and other spaced scripts compare whole words; Chinese, Japanese and
// Korean compare characters (they are written without spaces).
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
function units(text) {
  const out = [];
  for (const w of String(text ?? '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []) {
    if (CJK.test(w)) out.push(...w); else out.push(w.replace(/'/g, ''));
  }
  return out.filter(Boolean);
}

function contains(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

// The reading's sung images whose quote is really in the transcript, each once.
export function groundedImagery(reading, transcriptText) {
  const said = units(transcriptText);
  const seen = new Set();
  const out = [];
  for (const x of Array.isArray(reading?.sungImagery) ? reading.sungImagery : []) {
    const motif = String(x?.motif ?? '').trim(), quote = String(x?.quote ?? '').trim();
    const q = units(quote);
    if (!motif || !q.length || !contains(said, q)) continue;
    const key = motif.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ motif, quote });
  }
  return out;
}

// Whether a concept already names a motif: its head noun (last word), as a
// whole word, singular or plural.
export function namesMotif(concept, motif) {
  const head = String(motif ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.pop();
  if (!head) return false;
  const stem = /[^s]s$/.test(head) && head.length > 3 ? head.slice(0, -1) : head;
  return new RegExp(`(^|[^\\p{L}])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?(?![\\p{L}])`, 'iu').test(String(concept ?? ''));
}
