// Picks the account's Apple and server for this build: the native plugin and
// our endpoints in the iOS app, the development simulation everywhere else.

import { createAccount } from './index.js';
import { createNativeApple, createSimulatedApple } from './apple.js';
import { createHttpRemote, createSimulatedRemote } from './remote.js';
import { askAppleSimulator } from './simulator.js';

// `box` holds the account id and session ({ read, write }); by default the
// browser's localStorage. The native build passes one backed by the same
// Keychain id billing and the guard use, so there is one id for all three.
export function createAccountForDevice(app, { box } = {}) {
  const plugin = globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins?.SonmiraAppleSignIn : null;
  if (plugin) return createAccount({ apple: createNativeApple(plugin), remote: createHttpRemote(), box });
  return createAccount({ apple: createSimulatedApple({ ask: (req) => askAppleSimulator(app, req) }), remote: createSimulatedRemote(), box });
}
