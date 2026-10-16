// Picks the account's Apple and server for this build: the native plugin and
// our endpoints in the iOS app, the development simulation everywhere else.

import { createAccount } from './index.js';
import { createNativeApple, createSimulatedApple } from './apple.js';
import { createHttpRemote, createSimulatedRemote } from './remote.js';
import { askAppleSimulator } from './simulator.js';

export function createAccountForDevice(app) {
  const plugin = globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins?.SonmiraAppleSignIn : null;
  if (plugin) return createAccount({ apple: createNativeApple(plugin), remote: createHttpRemote() });
  return createAccount({ apple: createSimulatedApple({ ask: (req) => askAppleSimulator(app, req) }), remote: createSimulatedRemote() });
}
