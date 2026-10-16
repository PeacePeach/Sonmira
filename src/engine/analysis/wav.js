// Minimal WAV (RIFF) decoder: PCM 8/16/24/32-bit and float32, any channel
// count (mixed to mono). Lets Node tests and tools analyse real recordings.
export function decodeWav(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = null, o = 12;
  while (o + 8 <= b.length) {
    const id = tag(o), size = dv.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ') fmt = { format: dv.getUint16(body, true), channels: dv.getUint16(body + 2, true), sampleRate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    if (id === 'data' && fmt) {
      const bps = fmt.bits / 8, n = Math.floor(Math.min(size, b.length - body) / (bps * fmt.channels));
      const out = new Float32Array(n);
      const isFloat = fmt.format === 3;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const p = body + (i * fmt.channels + c) * bps;
          s += isFloat ? dv.getFloat32(p, true)
            : fmt.bits === 16 ? dv.getInt16(p, true) / 32768
            : fmt.bits === 8 ? (b[p] - 128) / 128
            : fmt.bits === 24 ? ((b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) << 8 >> 8) / 8388608
            : dv.getInt32(p, true) / 2147483648;
        }
        out[i] = s / fmt.channels;
      }
      return { samples: out, sampleRate: fmt.sampleRate };
    }
    o = body + size + (size & 1);
  }
  throw new Error('WAV has no data chunk');
}

// Mono samples (−1…1) → a 16-bit PCM WAV file. Used for the audio sent to
// transcription, so the words never depend on the browser's container/codec.
export function encodeWav(samples, sampleRate) {
  const n = samples.length, out = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, sampleRate, true); out.setUint32(28, sampleRate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Uint8Array(out.buffer);
}
