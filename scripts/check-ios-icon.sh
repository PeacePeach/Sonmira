#!/bin/bash
# Checks that a built Sonmira .app carries the App Icon:   scripts/check-ios-icon.sh path/to/App.app
#
# The icon reaches iOS (home screen, Settings, the purchase sheet) only through
# two things in the built bundle: CFBundleIcons → CFBundleIconName = AppIcon in
# its Info.plist (written by actool), and an AppIcon set inside Assets.car.
# Prints what it found and fails if either is missing. macOS only (assetutil).
set -euo pipefail

APP="${1:?usage: scripts/check-ios-icon.sh path/to/App.app}"
PLIST="$APP/Info.plist"
CAR="$APP/Assets.car"

fail() { echo "::error::App Icon check: $1"; exit 1; }

[ -f "$PLIST" ] || fail "no Info.plist in $APP"
[ -f "$CAR" ] || fail "no Assets.car in $APP"

echo "== Info.plist CFBundleIcons"
plutil -extract CFBundleIcons xml1 -o - "$PLIST" || fail "CFBundleIcons is missing from the built Info.plist"
NAME=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIcons:CFBundlePrimaryIcon:CFBundleIconName' "$PLIST" 2>/dev/null || true)
[ "$NAME" = "AppIcon" ] || fail "CFBundlePrimaryIcon:CFBundleIconName is '$NAME', expected AppIcon"

echo "== AppIcon renditions in Assets.car"
xcrun assetutil --info "$CAR" > "${TMPDIR:-/tmp}/sonmira-assets.json"
python3 - "${TMPDIR:-/tmp}/sonmira-assets.json" <<'PY'
import json, sys
items = [i for i in json.load(open(sys.argv[1])) if i.get('Name') == 'AppIcon']
for i in items:
    print(f"  {i.get('RenditionName')}  {i.get('PixelWidth')}x{i.get('PixelHeight')}  {i.get('AssetType')}")
if not items:
    print('::error::App Icon check: Assets.car has no AppIcon')
    sys.exit(1)
PY

echo "== Icon files at the bundle root"
ls "$APP" | grep -i '^AppIcon' || echo "  (none; the icon is only in Assets.car)"
echo "App Icon present in $APP"
