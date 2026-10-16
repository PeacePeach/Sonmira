// Short descriptive lines shown with the painting (design copy).
// They describe the sound ("low, soft, steady"); they do not grade it.

export function voiceLabel(features, completeness) {
  const hue = features?.hue?.mean ?? 240;
  const level = features?.level?.mean ?? 0;
  const register = hue > 190 ? 'Low' : hue > 110 ? 'Middle' : 'High';
  const loudness = level > 0.5 ? 'bright' : 'soft';
  const motion = { resolved: 'steady', gathered: 'drifting', loose: 'wandering' }[completeness] || 'wandering';
  return `${register}, ${loudness}, ${motion}`;
}

export function summaryLine(completeness, label) {
  if (completeness === 'resolved') return 'STEADY VOICE — IT BECAME A PLACE';
  if (completeness === 'gathered') return 'ALMOST STEADY — A PLACE IN THE MIST';
  return label.toUpperCase();
}

export function dryingLine(completeness) {
  if (completeness === 'resolved') return 'That was lovely. Something is appearing…';
  if (completeness === 'gathered') return 'Almost. A place is half-showing…';
  return 'Letting it dry…';
}
