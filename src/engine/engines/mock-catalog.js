// Representative watercolor set supplied with the design (style references —
// verify licensing before shipping). Tags were assigned by eye and are used
// only by the mock engine to pick a fitting stand-in painting.
//
// completeness: loose = abstract marks, gathered = half-legible scene,
// resolved = coherent scene. hue = dominant OKLCH-ish hue in degrees.

const A = 'assets/art/';

export const CATALOG = [
  // resolved — coherent, still painterly
  { src: A + 'scene-shore.png', completeness: 'resolved', emotions: ['melancholic', 'tender'], motifs: ['water', 'sky'], hue: 270, focus: '50% 62%' },
  { src: A + 'scene-city.png', completeness: 'resolved', emotions: ['bright', 'tender'], motifs: ['landscape'], hue: 60, focus: '50% 70%' },
  { src: A + 'scene-bay.png', completeness: 'resolved', emotions: ['bright', 'intense'], motifs: ['water', 'landscape'], hue: 220, focus: '50% 55%' },
  { src: A + 'scene-bay-light.png', completeness: 'resolved', emotions: ['bright', 'tender'], motifs: ['water', 'sky'], hue: 215, focus: '50% 50%' },
  // gathered — atmospheric, forms emerging
  { src: A + 'impression-1.png', completeness: 'gathered', emotions: ['tender'], motifs: ['landscape', 'water'], hue: 20, focus: '50% 50%' },
  { src: A + 'impression-2.png', completeness: 'gathered', emotions: ['bright'], motifs: ['water', 'garden'], hue: 160, focus: '50% 50%' },
  { src: A + 'impression-3.png', completeness: 'gathered', emotions: ['intense'], motifs: ['landscape'], hue: 260, focus: '50% 50%' },
  { src: A + 'impression-4.png', completeness: 'gathered', emotions: ['bright', 'tender'], motifs: ['sky', 'water'], hue: 30, focus: '50% 50%' },
  { src: A + 'impression-5.png', completeness: 'gathered', emotions: ['tender', 'bright'], motifs: ['sky', 'landscape'], hue: 90, focus: '50% 50%' },
  { src: A + 'impression-6.png', completeness: 'gathered', emotions: ['melancholic'], motifs: ['water'], hue: 230, focus: '50% 50%' },
  // loose — diffused pigment, fragmented
  { src: A + 'abstract-1.png', completeness: 'loose', emotions: ['tender'], motifs: ['sky', 'abstract'], hue: 190, focus: '50% 50%' },
  { src: A + 'abstract-2.png', completeness: 'loose', emotions: ['intense'], motifs: ['garden', 'abstract'], hue: 175, focus: '50% 50%' },
  { src: A + 'abstract-3.png', completeness: 'loose', emotions: ['bright'], motifs: ['abstract', 'garden'], hue: 45, focus: '50% 50%' },
  { src: A + 'abstract-4.png', completeness: 'loose', emotions: ['melancholic'], motifs: ['water', 'abstract'], hue: 265, focus: '50% 50%' },
  { src: A + 'abstract-5.png', completeness: 'loose', emotions: ['bright'], motifs: ['water', 'abstract'], hue: 200, focus: '50% 50%' },
  { src: A + 'abstract-6.png', completeness: 'loose', emotions: ['intense', 'melancholic'], motifs: ['landscape', 'abstract'], hue: 240, focus: '50% 50%' },
  { src: A + 'abstract-7.png', completeness: 'loose', emotions: ['intense'], motifs: ['abstract'], hue: 250, focus: '50% 50%' },
  { src: A + 'abstract-8.png', completeness: 'loose', emotions: ['tender'], motifs: ['water', 'abstract'], hue: 215, focus: '50% 50%' },
  { src: A + 'abstract-9.png', completeness: 'loose', emotions: ['melancholic'], motifs: ['sky', 'abstract'], hue: 255, focus: '50% 50%' },
];
