// Layer D: image-generation providers behind one shape.
//
// Every provider turns the same art direction (layer C) into an image. The
// app contract does not change with the provider; results carry a provider
// id so a painting is always labelled with what made it.
//
//   procedural  the original JS watercolour renderer, runs anywhere, free
//   openai      OpenAI image model, server side only (api/generate.js)

export const PROVIDERS = {
  procedural: { id: 'procedural', label: 'Procedural renderer (JS, no AI)', kind: 'procedural', where: 'client' },
  openai: { id: 'openai', label: 'OpenAI image model', kind: 'ai', where: 'server' },
};
