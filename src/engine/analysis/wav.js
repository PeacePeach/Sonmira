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
