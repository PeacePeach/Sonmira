// The watercolor set supplied with the design (style references; verify
// licensing before shipping). Paths are relative to the app root.
//
// Tags were assigned by looking at each painting:
//   completeness  loose = diffused marks, gathered = half-legible scene,
//                 resolved = coherent scene
//   emotions      colour moods the painting can carry
//   motifs        what it depicts
//   voiceHue      the live voice hue (pitch → hue, 255 low … 20 high) this
//                 painting answers to, following the design prototype's pools
//   loud          for near-identical pairs, which one suits a stronger voice

const A = 'assets/art/';

export const CATALOG = [
  // resolved
  { id: 'scene-shore', completeness: 'resolved', emotions: ['tender', 'melancholic'], motifs: ['water', 'sky'], voiceHue: 230, focus: '50% 62%' },
  { id: 'scene-bay', completeness: 'resolved', emotions: ['bright', 'intense'], motifs: ['water', 'landscape'], voiceHue: 160, loud: true, focus: '50% 55%' },
  { id: 'scene-bay-light', completeness: 'resolved', emotions: ['bright', 'tender'], motifs: ['water', 'sky'], voiceHue: 160, loud: false, focus: '50% 50%' },
  { id: 'scene-city', completeness: 'resolved', emotions: ['bright', 'intense'], motifs: ['landscape'], voiceHue: 80, focus: '50% 70%' },
  // gathered
  { id: 'impression-1', completeness: 'gathered', emotions: ['intense', 'melancholic'], motifs: ['landscape', 'water'], voiceHue: 140, focus: '50% 50%' },
  { id: 'impression-2', completeness: 'gathered', emotions: ['tender', 'bright'], motifs: ['garden', 'water'], voiceHue: 180, focus: '50% 50%' },
  { id: 'impression-3', completeness: 'gathered', emotions: ['bright', 'intense'], motifs: ['landscape'], voiceHue: 240, focus: '50% 50%' },
  { id: 'impression-4', completeness: 'gathered', emotions: ['intense', 'bright'], motifs: ['sky', 'water'], voiceHue: 100, focus: '50% 50%' },
  { id: 'impression-5', completeness: 'gathered', emotions: ['tender', 'melancholic'], motifs: ['sky', 'landscape'], voiceHue: 225, focus: '50% 50%' },
  { id: 'impression-6', completeness: 'gathered', emotions: ['melancholic', 'tender'], motifs: ['water', 'landscape'], voiceHue: 200, focus: '50% 50%' },
  // loose
  { id: 'abstract-1', completeness: 'loose', emotions: ['tender', 'bright'], motifs: ['abstract', 'water'], voiceHue: 190, focus: '50% 50%' },
  { id: 'abstract-2', completeness: 'loose', emotions: ['melancholic'], motifs: ['abstract'], voiceHue: 175, focus: '50% 50%' },
  { id: 'abstract-3', completeness: 'loose', emotions: ['bright'], motifs: ['abstract', 'garden'], voiceHue: 100, focus: '50% 50%' },
  { id: 'abstract-4', completeness: 'loose', emotions: ['melancholic'], motifs: ['abstract', 'water'], voiceHue: 250, focus: '50% 50%' },
  { id: 'abstract-5', completeness: 'loose', emotions: ['bright'], motifs: ['abstract', 'water'], voiceHue: 160, focus: '50% 50%' },
  { id: 'abstract-6', completeness: 'loose', emotions: ['intense', 'melancholic'], motifs: ['abstract', 'landscape'], voiceHue: 245, focus: '50% 50%' },
  { id: 'abstract-7', completeness: 'loose', emotions: ['intense'], motifs: ['abstract'], voiceHue: 240, focus: '50% 50%' },
  { id: 'abstract-8', completeness: 'loose', emotions: ['tender'], motifs: ['abstract', 'water'], voiceHue: 200, focus: '50% 50%' },
  { id: 'abstract-9', completeness: 'loose', emotions: ['intense', 'melancholic'], motifs: ['abstract', 'sky'], voiceHue: 255, focus: '50% 50%' },
].map((item) => ({ ...item, src: `${A}${item.id}.png` }));
