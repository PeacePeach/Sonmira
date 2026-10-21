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

// Whether a concept already names a motif: its head noun (last word), or
// any other content word of four letters or more ("kite with a broken
// string" is named by "a kite…"), as a whole word, singular or plural.
const FUNCTION_WORDS = new Set(['with', 'from', 'into', 'over', 'under', 'onto', 'upon', 'that', 'this', 'their', 'your', 'some', 'very']);
const wordIn = (text, w) => {
  const stem = /[^s]s$/.test(w) && w.length > 3 ? w.slice(0, -1) : w;
  return new RegExp(`(^|[^\\p{L}])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?(?![\\p{L}])`, 'iu').test(text);
};
export function namesMotif(concept, motif) {
  const words = String(motif ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return false;
  const text = String(concept ?? '');
  const head = words[words.length - 1];
  return [head, ...words.filter((w) => w.length >= 4 && !FUNCTION_WORDS.has(w))].some((w) => wordIn(text, w));
}
