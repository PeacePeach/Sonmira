// PNG encoding. Node: zlib via dynamic import. Browser: OffscreenCanvas / canvas.

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// Node only. image: { width, height, rgba }
export async function encodePNG({ width, height, rgba }) {
  const { deflateSync } = await import('node:zlib');
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, d = y * (width * 3 + 1) + 1 + x * 3;
      raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2];
    }
  }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Returns a Blob (image/png, or jpeg when asked). Uses the browser's encoder
// when there is one, otherwise the PNG encoder above (Node tests).
export async function toBlob({ width, height, rgba }, type = 'image/png', quality = 0.92) {
  if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') {
    return new Blob([await encodePNG({ width, height, rgba })], { type: 'image/png' });
  }
  const data = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width, height);
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(width, height);
    c.getContext('2d').putImageData(data, 0, 0);
    return c.convertToBlob({ type, quality });
  }
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  c.getContext('2d').putImageData(data, 0, 0);
  return new Promise((res) => c.toBlob(res, type, quality));
}
