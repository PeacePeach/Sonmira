// The iOS App Icon: the asset catalog holds the official Sonmira icon
// (assets/brand/app-icon-ivory-1024.png, unchanged) and the App target compiles
// it as its icon. The built bundle is checked on macOS by scripts/check-ios-icon.sh
// (iOS build and TestFlight workflows). Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SET = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
const contents = JSON.parse(readFileSync(`${SET}/Contents.json`, 'utf8'));

// width, height, colour type and whether the PNG has an alpha channel
function png(buf) {
  assert.equal(buf.toString('latin1', 1, 4), 'PNG');
  const colorType = buf[25];
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: colorType === 4 || colorType === 6 };
}

test('AppIcon is one 1024 px universal iOS image', () => {
  assert.equal(contents.images.length, 1);
  const [img] = contents.images;
  assert.deepEqual({ idiom: img.idiom, platform: img.platform, size: img.size }, { idiom: 'universal', platform: 'ios', size: '1024x1024' });
  assert.ok(img.filename);
});

test('the icon file is the official ivory icon, 1024×1024, with no alpha', () => {
  const file = readFileSync(`${SET}/${contents.images[0].filename}`);
  assert.ok(file.equals(readFileSync('assets/brand/app-icon-ivory-1024.png')), 'differs from assets/brand/app-icon-ivory-1024.png');
  assert.deepEqual(png(file), { width: 1024, height: 1024, alpha: false });
});

test('the App target compiles AppIcon in Debug and Release', () => {
  const pbx = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
  assert.equal(pbx.match(/ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/g)?.length, 2);
  assert.match(pbx, /Assets\.xcassets in Resources/);
});

test('Info.plist does not override the compiled icon', () => {
  const plist = readFileSync('ios/App/App/Info.plist', 'utf8');
  assert.doesNotMatch(plist, /CFBundleIcon/);
});
