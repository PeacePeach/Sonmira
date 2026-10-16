// Where the app is running: the iOS app (Capacitor's WKWebView, which
// injects window.Capacitor) or a browser. Nothing here loads in a browser
// beyond these few lines.

const cap = () => globalThis.Capacitor;
const plugins = new Map();

// The released site (native/ios.json appUrl). Vercel previews and local
// development keep the purchase simulation; here a browser cannot buy.
export const RELEASE_HOST = 'sonmira.vercel.app';
export const isReleaseSite = () => !isNativeIOS() && globalThis.location?.hostname === RELEASE_HOST;

export const isNativeIOS = () => !!cap()?.isNativePlatform?.() && cap().getPlatform?.() === 'ios';

/** A native plugin registered by the iOS app, or null in a browser. */
export function nativePlugin(name) {
  if (!isNativeIOS()) return null;
  if (!plugins.has(name)) plugins.set(name, cap().registerPlugin?.(name) ?? cap().Plugins?.[name] ?? null);
  return plugins.get(name);
}
