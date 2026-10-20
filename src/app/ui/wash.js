// The watercolour wash, drawn on the GPU.
//
// The design's wash is a set of soft elliptical strokes (radial gradients
// with a darker pooled rim, clipped to an irregular rounded shape) that
// multiply like glazes, then roughened by index.html's #wc filter: fractal
// noise displaces them into feathered edges and a fine noise settles
// granulation into the pigment. As a CSS `filter: url(#wc)` that filter is
// recomputed on the main thread for every frame the strokes move, which made
// every animation around it stutter, and iOS can drop it altogether (smooth
// ellipses, no bleed). Here the same strokes, the same noise (the Filter
// Effects reference turbulence, same seeds and frequencies) and the same
// displacement and granulation run in a WebGL2 shader, and each painting
// gets the result as a bitmap. The strokes' CSS motion (bloom, drift,
// bleed; painting.js classes alive / developing / resting) is replayed here
// with the same keyframes and easings; the wash element's own transform and
// opacity stay in CSS. Without WebGL2 the painting keeps the DOM strokes and
// the SVG filter (createWash returns null).

import { reduceMotion } from './morph.js';

const MARGIN = 24;        // px drawn around the wash: the displacement (±23 px) reaches into it
const DISPLACE = 46;      // #wc feDisplacementMap scale
const FLOW = { freq: 0.016, octaves: 4, seed: 7 };   // #wc "n"
const TOOTH = { freq: 0.9, octaves: 1, seed: 5 };    // #wc "tooth"

// ── the reference turbulence's tables (Filter Effects 1, feTurbulence) ─────
const BSIZE = 0x100;
function turbulenceTables(seed) {
  const M = 2147483647, A = 16807, Q = 127773, R = 2836;
  let s = seed <= 0 ? -(seed % (M - 1)) + 1 : seed > M - 1 ? M - 1 : seed;
  const random = () => { s = A * (s % Q) - R * Math.floor(s / Q); if (s <= 0) s += M; return s; };
  const lattice = new Int32Array(BSIZE + BSIZE + 2);
  const grad = [0, 1, 2, 3].map(() => new Float64Array((BSIZE + BSIZE + 2) * 2));
  let i;
  for (let k = 0; k < 4; k++) {
    for (i = 0; i < BSIZE; i++) {
      lattice[i] = i;
      for (let j = 0; j < 2; j++) grad[k][i * 2 + j] = ((random() % (BSIZE + BSIZE)) - BSIZE) / BSIZE;
      const n = Math.hypot(grad[k][i * 2], grad[k][i * 2 + 1]);
      grad[k][i * 2] /= n; grad[k][i * 2 + 1] /= n;
    }
  }
  while (--i) {
    const k = lattice[i], j = random() % BSIZE;
    lattice[i] = lattice[j]; lattice[j] = k;
  }
  for (i = 0; i < BSIZE + 2; i++) {
    lattice[BSIZE + i] = lattice[i];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 2; j++) grad[k][(BSIZE + i) * 2 + j] = grad[k][i * 2 + j];
  }
  // one RGBA32F texture, 514 × 3: row 0 lattice; rows 1–2 the R and G gradients
  const N = BSIZE + BSIZE + 2, data = new Float32Array(N * 3 * 4);
  for (let x = 0; x < N; x++) {
    data[x * 4] = lattice[x];
    for (let k = 0; k < 2; k++) { data[((k + 1) * N + x) * 4] = grad[k][x * 2]; data[((k + 1) * N + x) * 4 + 1] = grad[k][x * 2 + 1]; }
  }
  return { width: N, height: 3, data };
}

// ── timing, as CSS computes it ─────────────────────────────────────────────
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = X(t) - x, d = dX(t); if (Math.abs(e) < 1e-6) break; if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1;
    if (Math.abs(X(t) - x) > 1e-5) { t = x; while (hi - lo > 1e-6) { if (X(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
    return Y(t);
  };
}
const EASE_IN_OUT = bezier(0.42, 0, 0.58, 1), EASE_OUT = bezier(0, 0, 0.58, 1), BLEED = bezier(0.25, 0.6, 0.35, 1);

// styles.css: bloom 1s ease-out (opacity 0 → 1 at 60%, scale .5 → 1);
// pigmentDrift var(--dur) ease-in-out var(--delay) infinite alternate
// (translate 0 → --dx --dy, rotate 0 → 4deg); pigmentBleed 16s
// cubic-bezier(.25,.6,.35,1) both (scale 1 → --spread, opacity 1 → .82).
function motion(s, now, st) {
  let tx = 0, ty = 0, rot = 0, scale = 1, opacity = 1;
  if (st.reduce) return { tx, ty, rot, scale, opacity };
  if (s.bloom) {
    const t = Math.min(1, Math.max(0, (now - s.born) / 1000));
    scale = 0.5 + 0.5 * EASE_OUT(t);
    opacity = t < 0.6 ? EASE_OUT(t / 0.6) : 1;
  }
  if (st.alive) {
    const start = Math.max(s.born, st.aliveSince);
    const local = (now - start) / 1000 - s.drift.delay;
    if (local >= 0) {
      const n = Math.floor(local / s.drift.dur), f = local / s.drift.dur - n;
      const p = EASE_IN_OUT(n % 2 ? 1 - f : f);
      tx = p * s.drift.dx; ty = p * s.drift.dy; rot = p * 4;
    }
    if (st.developing) {
      const t = Math.min(1, Math.max(0, (now - Math.max(s.born, st.developingSince)) / 16000));
      const e = BLEED(t);
      scale = 1 + (s.drift.spread - 1) * e; // the later animation in the list wins
      opacity = 1 - 0.18 * e;
    }
  }
  return { tx, ty, rot, scale, opacity };
}

// ── colour: the stroke's gradient stops, as painting.js wrote them ─────────
const f3 = (n) => +n.toFixed(3);
function stops(b) {
  const L = b.l, C = Math.min(0.2, b.c * 1.15), H = +b.hue.toFixed(1), A = Math.min(0.95, b.a);
  const col = (l, c, a) => [f3(l), f3(c), H, f3(a)];
  return [
    [0, col(L + 0.03, C, A * 0.5)], [0.55, col(L, C, A * 0.62)], [0.76, col(L - 0.05, C + 0.01, A * 0.8)],
    [0.86, col(L - 0.13, C + 0.03, Math.min(1, A * 1.35))], [0.9, col(L - 0.06, C, A * 0.5)], [0.94, col(L, C, 0)],
  ].map(([at, [l, c, h, a]]) => {
    // CSS gradients between oklch colours interpolate in premultiplied Oklab.
    const al = Math.min(1, Math.max(0, a)), ll = Math.min(1, Math.max(0, l)), r = (h * Math.PI) / 180;
    return { at, lab: [ll * al, Math.max(0, c) * Math.cos(r) * al, Math.max(0, c) * Math.sin(r) * al, al] };
  });
}

// border-radius "a% b% c% d% / e% f% g% h%" → corner radii in px (TL, TR, BR, BL), scaled as CSS does
function radii(br, w, h) {
  const parse = (part, side) => {
    const v = part.trim().split(/\s+/).map((x) => (x.endsWith('%') ? (parseFloat(x) / 100) * side : parseFloat(x)) || 0);
    return [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
  };
  const [hs, vs = hs] = String(br ?? '0').split('/');
  const rx = parse(hs, w), ry = parse(vs, h);
  const f = Math.min(1, w / (rx[0] + rx[1] || 1), w / (rx[3] + rx[2] || 1), h / (ry[0] + ry[3] || 1), h / (ry[1] + ry[2] || 1));
  return [0, 1, 2, 3].flatMap((i) => [rx[i] * f, ry[i] * f]);
}

// ── shaders ────────────────────────────────────────────────────────────────
const STROKE_VS = `#version 300 es
in vec2 a_q;
uniform vec2 u_box;      // the stroke's box, px
uniform mat3 u_m;        // box px → canvas px
uniform vec2 u_canvas;   // canvas, px (CSS px × scale)
out vec2 v_q;
void main() {
  v_q = a_q * u_box;
  vec2 p = (u_m * vec3(v_q, 1.0)).xy;
  gl_Position = vec4(p / u_canvas * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`;

const STROKE_FS = `#version 300 es
precision highp float;
in vec2 v_q;
uniform vec2 u_box;
uniform vec4 u_r[2];       // corner radii: TL(x,y) TR(x,y) | BR(x,y) BL(x,y)
uniform vec4 u_lab[6];     // premultiplied Oklab + alpha
uniform float u_at[6];
uniform float u_opacity;
out vec4 o;
vec3 toSRGB(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  float l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  vec3 c = vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
               -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
               -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float corner(vec2 q, vec2 c, vec2 r) { // signed, in ellipse units, > 0 outside
  vec2 d = (q - c) / max(r, vec2(1e-3));
  return length(d) - 1.0;
}
void main() {
  vec2 h = u_box * 0.5;
  float t = length((v_q - h) / h);
  vec4 c = u_lab[5];
  for (int i = 0; i < 5; i++) {
    if (t <= u_at[i + 1]) {
      float f = clamp((t - u_at[i]) / (u_at[i + 1] - u_at[i]), 0.0, 1.0);
      c = mix(u_lab[i], u_lab[i + 1], f);
      break;
    }
  }
  if (t <= u_at[0]) c = u_lab[0];
  float a = c.a;
  vec3 rgb = a > 0.0 ? toSRGB(c.xyz / a) : vec3(0.0);
  // the stroke's rounded box (border-radius), antialiased
  vec2 q = v_q, b = u_box;
  vec2 tl = u_r[0].xy, tr = u_r[0].zw, br = u_r[1].xy, bl = u_r[1].zw;
  float d = -1.0;
  if (q.x < tl.x && q.y < tl.y) d = corner(q, tl, tl);
  else if (q.x > b.x - tr.x && q.y < tr.y) d = corner(q, vec2(b.x - tr.x, tr.y), tr);
  else if (q.x > b.x - br.x && q.y > b.y - br.y) d = corner(q, b - br, br);
  else if (q.x < bl.x && q.y > b.y - bl.y) d = corner(q, vec2(bl.x, b.y - bl.y), bl);
  float w = max(fwidth(d), 1e-4);
  float edge = min(min(q.x, q.y), min(b.x - q.x, b.y - q.y));
  float mask = clamp(0.5 - d / w, 0.0, 1.0) * clamp(edge / max(fwidth(q.x), 1e-4) + 0.5, 0.0, 1.0);
  a *= mask * u_opacity;
  // Multiply, kept "over white": U = C + 1 - α multiplies exactly, α composites over.
  o = vec4(rgb * a + 1.0 - a, a);
}`;

const FILTER_VS = `#version 300 es
in vec2 a_q;
void main() { gl_Position = vec4(a_q * 2.0 - 1.0, 0.0, 1.0); }`;

const FILTER_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_src;      // strokes, "over white"
uniform highp sampler2D u_flowT, u_toothT;
uniform vec2 u_canvas;        // px
uniform float u_k;            // px per CSS px
uniform float u_margin;
out vec4 o;
const int BM = 255;
float lat(highp sampler2D T, int i) { return texelFetch(T, ivec2(i, 0), 0).r; }
vec2 grad(highp sampler2D T, int ch, int i) { return texelFetch(T, ivec2(i, ch + 1), 0).rg; }
float noise2(highp sampler2D T, int ch, vec2 v) {
  float t = v.x + 4096.0;
  int bx0 = int(t) & BM, bx1 = (bx0 + 1) & BM;
  float rx0 = t - floor(t), rx1 = rx0 - 1.0;
  t = v.y + 4096.0;
  int by0 = int(t) & BM, by1 = (by0 + 1) & BM;
  float ry0 = t - floor(t), ry1 = ry0 - 1.0;
  int i = int(lat(T, bx0)), j = int(lat(T, bx1));
  int b00 = int(lat(T, i + by0)), b10 = int(lat(T, j + by0)), b01 = int(lat(T, i + by1)), b11 = int(lat(T, j + by1));
  float sx = rx0 * rx0 * (3.0 - 2.0 * rx0), sy = ry0 * ry0 * (3.0 - 2.0 * ry0);
  vec2 q = grad(T, ch, b00); float u = rx0 * q.x + ry0 * q.y;
  q = grad(T, ch, b10); float w = rx1 * q.x + ry0 * q.y;
  float a = mix(u, w, sx);
  q = grad(T, ch, b01); u = rx0 * q.x + ry1 * q.y;
  q = grad(T, ch, b11); w = rx1 * q.x + ry1 * q.y;
  float b = mix(u, w, sx);
  return mix(a, b, sy);
}
float fractal(highp sampler2D T, int ch, vec2 p, float freq, int octaves) {
  float sum = 0.0, ratio = 1.0;
  vec2 v = p * freq;
  for (int o = 0; o < 4; o++) {
    if (o >= octaves) break;
    sum += noise2(T, ch, v) / ratio;
    v *= 2.0; ratio *= 2.0;
  }
  return clamp((sum + 1.0) * 0.5, 0.0, 1.0);
}
vec4 src(vec2 user) { // premultiplied, transparent outside
  vec2 px = (user + u_margin) * u_k;
  if (px.x < 0.0 || px.y < 0.0 || px.x > u_canvas.x || px.y > u_canvas.y) return vec4(0.0);
  vec4 s = texture(u_src, vec2(px.x, u_canvas.y - px.y) / u_canvas);
  return vec4(max(s.rgb - (1.0 - s.a), 0.0), s.a);
}
uniform sampler2D u_noise;     // .rg the flow noise, .b the specks (NOISE_FS), per pixel
void main() {
  vec2 px = vec2(gl_FragCoord.x, u_canvas.y - gl_FragCoord.y);
  vec2 user = px / u_k - u_margin;  // the wash's own coordinates, CSS px
  vec4 n = texelFetch(u_noise, ivec2(gl_FragCoord.xy), 0);
  // pigment carried through wet paper
  vec4 flow = src(user + ${DISPLACE}.0 * (n.rg - 0.5));
  // granulation: pigment settling into the paper's tooth
  vec4 s = flow * n.b;
  o = vec4(s.rgb * flow.rgb + s.rgb * (1.0 - flow.a) + flow.rgb * (1.0 - s.a), s.a + flow.a - s.a * flow.a);
}`;

// The noise #wc reads doesn't move: it is computed once per canvas size.
const NOISE_FS = FILTER_FS.replace(/uniform sampler2D u_noise;[\s\S]*$/, `void main() {
  vec2 px = vec2(gl_FragCoord.x, u_canvas.y - gl_FragCoord.y);
  vec2 user = px / u_k - u_margin;
  o = vec4(fractal(u_flowT, 0, user, ${FLOW.freq}, ${FLOW.octaves}), fractal(u_flowT, 1, user, ${FLOW.freq}, ${FLOW.octaves}),
           clamp(1.5 * fractal(u_toothT, 0, user, ${TOOTH.freq}, ${TOOTH.octaves}) - 0.72, 0.0, 1.0), 1.0);
}`);

// The paper grain (index.html #grain): fractal noise, tinted to the paper's
// fibres. Baked once into a bitmap every painting shares.
const GRAIN = { freq: 0.85, octaves: 2, seed: 3 };
// #grain has no color-interpolation-filters, so it works in linearRGB: its
// tint (0.42, 0.37, 0.3) is linear, shown in sRGB.
const GRAIN_TINT = [0.42, 0.37, 0.3].map((c) => (1.055 * c ** (1 / 2.4) - 0.055).toFixed(4)).join(', ');
const GRAIN_FS = FILTER_FS.replace(/void main\(\) \{[\s\S]*$/, `void main() {
  vec2 px = vec2(gl_FragCoord.x, u_canvas.y - gl_FragCoord.y);
  float a = clamp(0.55 * fractal(u_flowT, 0, px / u_k, ${GRAIN.freq}, ${GRAIN.octaves}) - 0.18, 0.0, 1.0);
  o = vec4(vec3(${GRAIN_TINT}) * a, a);
}`);

// ── a renderer: a WebGL2 context with the programs and noise tables ────────
function makeRenderer(canvas) {
  try {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    const half = !!gl.getExtension('EXT_color_buffer_half_float') || !!gl.getExtension('EXT_color_buffer_float');
    const program = (vs, fs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.bindAttribLocation(p, 0, 'a_q');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
        const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
        u[name] = gl.getUniformLocation(p, name);
      }
      return { p, u };
    };
    const strokes = program(STROKE_VS, STROKE_FS), filter = program(FILTER_VS, FILTER_FS), grainP = program(FILTER_VS, GRAIN_FS), noiseP = program(FILTER_VS, NOISE_FS);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const table = (t) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, t.width, t.height, 0, gl.RGBA, gl.FLOAT, t.data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return tex;
    };
    const flowT = table(turbulenceTables(FLOW.seed)), toothT = table(turbulenceTables(TOOTH.seed)), grainT = table(turbulenceTables(GRAIN.seed));
    const target = { tex: gl.createTexture(), fb: gl.createFramebuffer(), w: 0, h: 0 };
    const noise = { tex: gl.createTexture(), fb: gl.createFramebuffer(), key: '' };
    const texture = (t, W, H) => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, W, H, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };

    return {
      canvas,
      release() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
      // The grain over a cssW × cssH area, as a PNG blob.
      grain(cssW, cssH, k) {
        const W = Math.round(cssW * k), H = Math.round(cssH * k);
        canvas.width = W; canvas.height = H;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        gl.useProgram(grainP.p);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, grainT);
        gl.uniform1i(grainP.u.u_flowT, 1);
        gl.uniform2f(grainP.u.u_canvas, W, H);
        gl.uniform1f(grainP.u.u_k, k);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.activeTexture(gl.TEXTURE0);
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        c.getContext('2d').drawImage(canvas, 0, 0);
        return new Promise((r) => c.toBlob(r, 'image/png'));
      },
      // Draws the strokes on this renderer's canvas, then copies them into
      // `out` (a 2D canvas the painting shows) when there is one.
      draw(out, list, cssW, cssH, k, now, st) {
        const W = Math.max(1, Math.round((cssW + 2 * MARGIN) * k)), H = Math.max(1, Math.round((cssH + 2 * MARGIN) * k));
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        if (target.w !== W || target.h !== H) {
          texture(target.tex, W, H);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.tex, 0);
          target.w = W; target.h = H;
        }
        if (noise.key !== `${W}x${H}@${k}`) { // the displacement and specks, once per size
          texture(noise.tex, W, H);
          gl.bindFramebuffer(gl.FRAMEBUFFER, noise.fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, noise.tex, 0);
          gl.viewport(0, 0, W, H);
          gl.useProgram(noiseP.p);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, flowT);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, toothT);
          gl.uniform1i(noiseP.u.u_flowT, 1); gl.uniform1i(noiseP.u.u_toothT, 2);
          gl.uniform2f(noiseP.u.u_canvas, W, H);
          gl.uniform1f(noiseP.u.u_k, k);
          gl.uniform1f(noiseP.u.u_margin, MARGIN);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          gl.activeTexture(gl.TEXTURE0);
          noise.key = `${W}x${H}@${k}`;
        }
        // 1. the strokes, multiplied (kept over white)
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
        gl.viewport(0, 0, W, H);
        gl.clearColor(1, 1, 1, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.ZERO, gl.SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(strokes.p);
        gl.uniform2f(strokes.u.u_canvas, W, H);
        for (const s of list) {
          const m = motion(s, now, st);
          if (m.opacity <= 0) continue;
          const bw = (s.b.w / 100) * cssW, bh = (s.b.h / 100) * cssH;
          if (bw <= 0 || bh <= 0) continue;
          // CSS: origin at the box centre; translate, rotate, scale, then
          // transform: translate(-50%, -50%) rotate(--rot).
          const ox = (s.b.x / 100) * cssW + bw / 2, oy = (s.b.y / 100) * cssH + bh / 2;
          const r1 = ((s.b.rot || 0) * Math.PI) / 180, r2 = (m.rot * Math.PI) / 180;
          const c1 = Math.cos(r1), s1 = Math.sin(r1), c2 = Math.cos(r2), s2 = Math.sin(r2), sc = m.scale;
          // v → R2 · sc · (R1 · v − half) + t ; v = q − half
          const a = sc * (c2 * c1 - s2 * s1), b = sc * (s2 * c1 + c2 * s1), c = sc * (-c2 * s1 - s2 * c1), d = sc * (-s2 * s1 + c2 * c1);
          const hx = bw / 2, hy = bh / 2;
          const tx0 = (m.tx / 100) * bw, ty0 = (m.ty / 100) * bh;
          // offset for q: −R1·half, then −half, scaled and rotated
          const ex = -(a * hx + c * hy) - sc * (c2 * hx - s2 * hy) + tx0 + ox + MARGIN;
          const ey = -(b * hx + d * hy) - sc * (s2 * hx + c2 * hy) + ty0 + oy + MARGIN;
          gl.uniformMatrix3fv(strokes.u.u_m, false, [a * k, b * k, 0, c * k, d * k, 0, ex * k, ey * k, 1]);
          gl.uniform2f(strokes.u.u_box, bw, bh);
          if (s.rFor !== bw + 'x' + bh) { s.r = new Float32Array(radii(s.b.br, bw, bh)); s.rFor = bw + 'x' + bh; }
          gl.uniform4fv(strokes.u.u_r, s.r);
          gl.uniform4fv(strokes.u.u_lab, s.lab);
          gl.uniform1fv(strokes.u.u_at, s.at);
          gl.uniform1f(strokes.u.u_opacity, m.opacity);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.disable(gl.BLEND);
        // 2. displacement and granulation (#wc)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        gl.useProgram(filter.p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, target.tex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, noise.tex);
        gl.uniform1i(filter.u.u_src, 0); gl.uniform1i(filter.u.u_noise, 1);
        gl.uniform2f(filter.u.u_canvas, W, H);
        gl.uniform1f(filter.u.u_k, k);
        gl.uniform1f(filter.u.u_margin, MARGIN);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.activeTexture(gl.TEXTURE0);
        if (!out) return;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        const ctx = out.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(canvas, 0, 0);
      },
    };
  } catch (e) {
    console.warn('[sonmira] GPU wash unavailable, using the SVG filter', e);
    return null;
  }
}

// The shared one: draws still washes (a stroke list once) and the grain, and
// hands each painting a copy. A wash that moves gets a context of its own,
// shown directly, so no frame is copied.
let renderer;
function getRenderer() {
  if (renderer !== undefined) return renderer;
  renderer = makeRenderer(document.createElement('canvas'));
  renderer?.canvas.addEventListener('webglcontextlost', () => { renderer = null; });
  return renderer;
}

// Every painting whose wash is moving, drawn on one animation frame.
const moving = new Set();
let frame = 0;
function tick() {
  frame = 0;
  const now = performance.now();
  for (const w of moving) w.render(now);
  if (moving.size) frame = requestAnimationFrame(tick);
}
const wake = () => { if (!frame && moving.size) frame = requestAnimationFrame(tick); };

/**
 * The wash of one painting, drawn by the shared renderer into a canvas
 * inside `washEl`. Null when WebGL2 isn't available.
 * @param {HTMLElement} washEl  the .wash element (its CSS transform and opacity still apply)
 * @param {HTMLElement} paintingEl  the .painting (alive / developing / resting / covered)
 */
export function createWash(washEl, paintingEl) {
  if (!getRenderer()) return null;
  const canvas = () => { const c = document.createElement('canvas'); c.className = 'wash-gl'; c.setAttribute('aria-hidden', 'true'); return c; };
  let out = canvas(), live = null; // live: this wash's own renderer while it moves
  washEl.append(out);
  washEl.classList.add('gl');
  // A moving wash draws on its own canvas; a still one (or one covered by
  // its artwork) goes back to a copy from the shared renderer.
  function goLive(on) {
    if (!!live === on) return;
    if (on) {
      const c = canvas();
      live = makeRenderer(c);
      if (!live) return;
      out.replaceWith(c); out = c;
    } else {
      live.release(); live = null;
      const c = canvas();
      out.replaceWith(c); out = c; dirty = true;
    }
  }

  let list = [], w = 0, h = 0, dirty = true;
  // Paused time (resting): CSS holds every animation where it is.
  let pausedAt = null, pausedFor = 0;
  const st = { alive: false, aliveSince: 0, developing: false, developingSince: 0, reduce: reduceMotion() };
  const clock = () => (pausedAt ?? performance.now()) - pausedFor;

  function readClasses() {
    const c = paintingEl.classList, now = performance.now();
    if (c.contains('alive') !== st.alive) { st.alive = !st.alive; st.aliveSince = now - pausedFor; }
    if (c.contains('developing') !== st.developing) { st.developing = !st.developing; st.developingSince = now - pausedFor; }
    const resting = c.contains('resting');
    if (resting && pausedAt == null) pausedAt = now;
    if (!resting && pausedAt != null) { pausedFor += now - pausedAt; pausedAt = null; }
    st.reduce = reduceMotion();
    update();
  }
  const classes = new MutationObserver(readClasses);
  classes.observe(paintingEl, { attributes: true, attributeFilter: ['class'] });

  const sized = new ResizeObserver(([e]) => {
    const nw = e.contentRect.width, nh = e.contentRect.height;
    if (nw === w && nh === h) return;
    w = nw; h = nh; dirty = true; update();
  });
  sized.observe(washEl);

  const covered = () => paintingEl.classList.contains('covered') || paintingEl.classList.contains('art-pending');
  // Moving while any stroke is: blooming, drifting (alive) or bleeding.
  const animating = () => !st.reduce && pausedAt == null && (st.alive || list.some((s) => s.bloom && clock() - s.born < 1100));

  const self = {
    render() {
      if (!w || !h || covered() || !paintingEl.isConnected) { moving.delete(self); return; }
      goLive(animating());
      const k = Math.min(3, globalThis.devicePixelRatio || 1);
      if (live) live.draw(null, list, w, h, k, clock(), st);
      else getRenderer()?.draw(out, list, w, h, k, clock(), st);
      dirty = false;
      if (!animating()) moving.delete(self);
    },
  };
  function update() {
    if (covered() || !w || !h) { moving.delete(self); if (live && covered()) goLive(false); return; }
    if (animating() || dirty) { moving.add(self); wake(); }
  }

  // how many strokes the wash holds (data-strokes, for tests and the dev panel)
  const counted = () => { washEl.dataset.strokes = list.length; dirty = true; update(); };
  readClasses();
  return {
    add(b, bloom = false, i = list.length) { list.push(stroke(b, bloom, i, clock())); counted(); },
    set(strokes) { list = (strokes || []).filter(Boolean).map((b, i) => stroke(b, false, i, -1e9)); counted(); },
    refresh() { dirty = true; update(); },
    destroy() { classes.disconnect(); sized.disconnect(); moving.delete(self); live?.release(); live = null; },
  };
}

// painting.js driftVars, kept as numbers.
function stroke(b, bloom, i, born) {
  const r = (k) => { const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  return {
    b, bloom, born,
    lab: new Float32Array(stops(b).flatMap((x) => x.lab)), at: new Float32Array(stops(b).map((x) => x.at)),
    drift: { dx: +((r(1) - 0.5) * 14).toFixed(1), dy: +((r(2) - 0.5) * 14).toFixed(1), dur: +(5 + r(3) * 4).toFixed(2), delay: +(-r(4) * 8).toFixed(2), spread: +(1.12 + r(5) * 0.12).toFixed(3) },
  };
}

/**
 * Bakes the paper grain once (GPU) for paintings up to cssW × cssH and
 * shows it from then on instead of each painting's own SVG filter: sets
 * --grain-image and html.grain-baked. Resolves false when it can't.
 */
export async function bakeGrain(cssW, cssH) {
  const r = getRenderer();
  if (!r) return false;
  try {
    const k = Math.min(3, globalThis.devicePixelRatio || 1);
    const blob = await r.grain(cssW, cssH, k);
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    const root = document.documentElement;
    root.style.setProperty('--grain-image', `url(${url})`);
    root.style.setProperty('--grain-size', `${cssW}px ${cssH}px`);
    root.classList.add('grain-baked');
    return true;
  } catch (e) {
    console.warn('[sonmira] grain not baked', e);
    return false;
  }
}
