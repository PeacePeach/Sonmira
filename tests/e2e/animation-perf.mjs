// Animation performance, measured the same way before and after a change:
// an iPhone-sized page (393×852 at 3×, touch) on a CPU slowed 4×, with the
// mock engine (no network, no paid calls) and diary entries whose artwork is
// a 1024×1536 JPEG blob, like the AI engine's. Each scenario records:
//
//   frames   rAF intervals while it runs: p50 / p95 / worst (ms) and how many
//            frames took longer than 1.5 × 16.7 ms (dropped at 60 fps)
//   long     long tasks (> 50 ms) and their total
//   layout   Layout and style recalculation count and time (CDP metrics)
//   paint    main-thread Paint time and raster time (trace)
//
// Chromium is not WebKit: SVG filters, compositing and image decoding differ
// on iOS, so these numbers compare runs with each other; they don't predict
// an iPhone's frame rate.
//
//   node server.js &  then  node tests/e2e/animation-perf.mjs
//   BASE=http://localhost:5174/ OUT=before.json node tests/e2e/animation-perf.mjs

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173/';
const CPU = Number(process.env.CPU || 4);
const RUNS = Number(process.env.RUNS || 3);
// Headless Chromium has no GPU here: WebGL would run on SwiftShader (the
// CPU) and slow the whole compositor, so by default it is off and the wash
// takes its SVG-filter fallback. GL=1 turns SwiftShader on.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--autoplay-policy=no-user-gesture-required', ...(process.env.GL ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : ['--disable-webgl'])] });

const LONG = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}: the rain kept on through the evening, and the song stayed with it.`).join('\n\n');

async function setup() {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem('sonmira.previewSeeded', '1'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '?ux-preview');
  await page.waitForSelector('[data-screen=diary]');
  // Six entries, their artwork as the AI engine stores it: a JPEG blob.
  await page.evaluate(async (LONG) => {
    const app = window.sonmira;
    await (await import('/src/app/dev.js')).seed(app);
    await (await import('/src/app/dev.js')).seed(app);
    for (const e of app.sortedEntries()) {
      const a = e.painting?.artwork;
      if (!a?.src) continue;
      const img = new Image(); img.src = a.src; await img.decode();
      const c = document.createElement('canvas'); c.width = 1024; c.height = 1536;
      const g = c.getContext('2d'), k = Math.max(1024 / img.width, 1536 / img.height);
      g.drawImage(img, (1024 - img.width * k) / 2, (1536 - img.height * k) / 2, img.width * k, img.height * k);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      await app.updateEntry({ ...e, journal: LONG, painting: { ...e.painting, artwork: { kind: 'image', blob, focus: a.focus } } });
    }
    app.navigate('diary');
  }, LONG);
  await page.waitForTimeout(1200);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ type: 'longtask', buffered: false });
  });
  return { ctx, page, cdp, errors };
}

const METRICS = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration'];
async function metrics(cdp) {
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(m.filter((x) => METRICS.includes(x.name)).map((x) => [x.name, x.value]));
}

// Runs `act`, recording frames, long tasks, layout and paint until `ms` later.
async function measure({ page, cdp }, name, act, ms) {
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
  const m0 = await metrics(cdp);
  await page.evaluate(() => {
    window.__long.length = 0;
    window.__frames = [];
    let last = performance.now();
    const f = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < 2000) window.__raf = requestAnimationFrame(f); };
    window.__raf = requestAnimationFrame(f);
  });
  await act();
  await page.waitForTimeout(ms);
  const { frames, long } = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return { frames: window.__frames.slice(1), long: window.__long.slice() }; });
  const m1 = await metrics(cdp);
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  await done;
  cdp.removeAllListeners('Tracing.dataCollected');
  const sum = (n) => events.filter((e) => e.name === n && e.ph === 'X').reduce((s, e) => s + (e.dur || 0), 0) / 1000;
  const sorted = [...frames].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  return {
    name,
    frames: frames.length,
    p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), worst: +(sorted[sorted.length - 1] ?? 0).toFixed(1),
    dropped: frames.filter((f) => f > 25).length,
    longTasks: long.length, longMs: Math.round(long.reduce((s, x) => s + x, 0)),
    layouts: m1.LayoutCount - m0.LayoutCount, layoutMs: Math.round((m1.LayoutDuration - m0.LayoutDuration) * 1000),
    styles: m1.RecalcStyleCount - m0.RecalcStyleCount, styleMs: Math.round((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000),
    paintMs: Math.round(sum('Paint') + sum('PaintImage')), rasterMs: Math.round(sum('RasterTask')),
  };
}

const key = (page, k) => page.evaluate((k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })), k);

async function run() {
  const s = await setup();
  const { page } = s;
  const out = [];
  const first = () => page.evaluate(() => window.sonmira.sortedEntries()[0].id);
  out.push(await measure(s, 'diary → detail', async () => { const id = await first(); await page.evaluate((id) => window.sonmira.navigate('detail', { id }), id); }, 900));
  out.push(await measure(s, 'detail expanded → compact', () => key(page, 'ArrowDown'), 900));
  out.push(await measure(s, 'journal scroll (compact)', async () => {
    const b = await page.$eval('.detail-scroll', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 60 }; });
    await page.mouse.move(b.x, b.y);
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(30); }
  }, 600));
  await page.$eval('.detail-scroll', (e) => { e.scrollTop = 0; });
  await page.waitForTimeout(400);
  out.push(await measure(s, 'detail compact → expanded', () => key(page, 'ArrowUp'), 900));
  out.push(await measure(s, 'detail Edit (→ editing)', () => page.click('[data-screen=detail] .edit-btn'), 900));
  out.push(await measure(s, 'detail Cancel (→ compact)', () => page.click('[data-screen=detail] .cancel-btn'), 900));
  out.push(await measure(s, 'detail → diary', () => page.click('[aria-label="Back to diary"]'), 900));
  out.push(await measure(s, 'diary scroll', async () => {
    await page.mouse.move(196, 420);
    for (let i = 0; i < 16; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(30); }
  }, 600));
  await page.$eval('.diary-scroll', (e) => { e.scrollTop = 0; });
  out.push(await measure(s, 'diary → sing', () => page.click('.fab'), 900));
  out.push(await measure(s, 'sing: recording (sample voice)', async () => {
    await page.click('[aria-label="Start recording"]');
    await page.waitForSelector('[data-phase=singing]');
  }, 3000));
  await page.click('[aria-label="Stop recording"]');
  await page.waitForSelector('[data-phase=preview]');
  out.push(await measure(s, 'sing: generating → reveal → expanded', () => page.click('text=Create painting'), 6000));
  await page.waitForSelector('[data-step=expanded]', { timeout: 20000 });
  await page.waitForTimeout(800);
  out.push(await measure(s, 'sing: Next (→ thumbnail)', () => page.click('text=Next'), 900));
  out.push(await measure(s, 'sing: thumbnail → expanded', () => page.click('.sing-canvas .painting'), 900));
  await page.click('text=Next');
  await page.waitForTimeout(800);
  await page.fill('[data-step=journal] .caption-input', 'Perf');
  out.push(await measure(s, 'sing: Save → diary', () => page.click('[data-step=journal] .pill'), 1200));
  if (s.errors.length) console.warn('page errors:', s.errors);
  await s.ctx.close();
  return out;
}

const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(await run());
// The median of each number over the runs.
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const result = runs[0].map((r, i) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? med(runs.map((x) => x[i][k])) : v])));
console.table(result);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ base: BASE, cpu: CPU, runs: RUNS, result }, null, 2));
await browser.close();
