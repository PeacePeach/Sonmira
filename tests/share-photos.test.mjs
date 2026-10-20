// Save to Photos (src/app/share/photos.js) against a fake SonmiraPhotos
// plugin that reassembles what the iOS app would write. The native side is
// ios/App/App/SonmiraPhotosPlugin.swift; tests/e2e/save-photos.mjs drives the
// share sheet in a browser. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { photosAvailable, saveToPhotos, PhotosError } from '../src/app/share/photos.js';

function fakePlugin({ finishError = null, appendError = null } = {}) {
  const p = {
    files: [], open: {}, discarded: [], calls: 0,
    async begin({ kind, ext }) { const id = `f${++p.calls}`; p.open[id] = { kind, ext, parts: [] }; return { id }; },
    async append({ id, data }) {
      if (appendError) throw appendError;
      p.open[id].parts.push(Buffer.from(data, 'base64'));
    },
    async finish({ id }) {
      if (finishError) throw finishError;
      const f = p.open[id]; delete p.open[id];
      p.files.push({ kind: f.kind, ext: f.ext, bytes: Buffer.concat(f.parts), chunks: f.parts.length });
    },
    async discard({ id }) { p.discarded.push(id); delete p.open[id]; },
  };
  return p;
}

const bytes = (n, seed = 7) => { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) b[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24; return b; };

test('a JPG goes to Photos as an image, byte for byte', async () => {
  const p = fakePlugin();
  const data = bytes(180_000);
  await saveToPhotos(new File([data], 'sonmira-2026-10-20-feed.jpg', { type: 'image/jpeg' }), p);
  assert.equal(p.files.length, 1);
  assert.equal(p.files[0].kind, 'image');
  assert.equal(p.files[0].ext, 'jpg');
  assert.deepEqual(new Uint8Array(p.files[0].bytes), data, 'no re-encoding: the exported JPG itself');
});

test('an MP4 goes to Photos as a video, in chunks, unchanged (audio track included)', async () => {
  const p = fakePlugin();
  const data = bytes(2_500_000, 3); // bigger than one bridge call
  await saveToPhotos(new File([data], 'sonmira-2026-10-20.mp4', { type: 'video/mp4' }), p);
  assert.equal(p.files[0].kind, 'video');
  assert.equal(p.files[0].ext, 'mp4');
  assert.ok(p.files[0].chunks > 1, 'sent in several bridge calls');
  assert.deepEqual(new Uint8Array(p.files[0].bytes), data);
});

test('Photos access turned off is reported as denied', async () => {
  const p = fakePlugin({ finishError: Object.assign(new Error('Photos access is off'), { code: 'denied' }) });
  await assert.rejects(saveToPhotos(new File([bytes(10)], 'a.jpg', { type: 'image/jpeg' }), p),
    (e) => e instanceof PhotosError && e.kind === 'denied');
});

test('a Photos failure is reported as failed', async () => {
  const p = fakePlugin({ finishError: Object.assign(new Error('nope'), { code: 'failed' }) });
  await assert.rejects(saveToPhotos(new File([bytes(10)], 'a.mp4', { type: 'video/mp4' }), p),
    (e) => e instanceof PhotosError && e.kind === 'failed');
});

test('a transfer that breaks midway is discarded on the device', async () => {
  const p = fakePlugin({ appendError: new Error('bridge') });
  await assert.rejects(saveToPhotos(new File([bytes(10)], 'a.jpg', { type: 'image/jpeg' }), p),
    (e) => e instanceof PhotosError && e.kind === 'failed');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(p.discarded, ['f1']);
});

test('an app build without the plugin is reported as unavailable', async () => {
  const old = { begin: async () => { throw Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' }); } };
  await assert.rejects(saveToPhotos(new File([bytes(10)], 'a.jpg', { type: 'image/jpeg' }), old),
    (e) => e instanceof PhotosError && e.kind === 'unavailable');
  await assert.rejects(saveToPhotos(new File([bytes(10)], 'a.jpg', { type: 'image/jpeg' }), null),
    (e) => e instanceof PhotosError && e.kind === 'unavailable');
});

test('Save to Photos is offered only in an iOS app that has the plugin', () => {
  const was = globalThis.Capacitor;
  try {
    delete globalThis.Capacitor;
    assert.equal(photosAvailable(), false, 'a browser');
    const ios = (has) => ({ isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: (n) => has && n === 'SonmiraPhotos' });
    globalThis.Capacitor = ios(false);
    assert.equal(photosAvailable(), false, 'TestFlight build 3 and older');
    globalThis.Capacitor = ios(true);
    assert.equal(photosAvailable(), true);
  } finally { globalThis.Capacitor = was; }
});

test('the iOS app registers the plugin and explains the Photos permission', () => {
  const root = new URL('../ios/App/', import.meta.url);
  const plist = readFileSync(new URL('App/Info.plist', root), 'utf8');
  assert.match(plist, /<key>NSPhotoLibraryAddUsageDescription<\/key>\s*<string>[^<]{10,}<\/string>/);
  assert.match(readFileSync(new URL('App/SonmiraBridgeViewController.swift', root), 'utf8'), /registerPluginInstance\(SonmiraPhotosPlugin\(\)\)/);
  const swift = readFileSync(new URL('App/SonmiraPhotosPlugin.swift', root), 'utf8');
  assert.match(swift, /jsName = "SonmiraPhotos"/);
  assert.match(swift, /requestAuthorization\(for: \.addOnly\)/, 'asks only to add, not to read the library');
  assert.match(readFileSync(new URL('App.xcodeproj/project.pbxproj', root), 'utf8'), /SonmiraPhotosPlugin\.swift in Sources/);
});
