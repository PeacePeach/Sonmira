// Picks the account's Apple and server for this build: the native plugin and
// our endpoints in the iOS app, the development simulation everywhere else.

import { createAccount } from './index.js';
import { createNativeApple, createSimulatedApple } from './apple.js';
import { createHttpRemote, createSimulatedRemote } from './remote.js';
import { askAppleSimulator } from './simulator.js';
import { isNativeIOS, isReleaseSite } from '../native/platform.js';

// `box` holds the account id and session ({ read, write }); by default the
// browser's localStorage. The native build passes one backed by the same
// Keychain id billing and the guard use, so there is one id for all three;
// `newId` makes a fresh guest id (a UUID on iOS).
//
// signInOffered: whether Settings shows Account (Sign in with Apple). Only
// with the real native plugin, or on localhost and test deployments where the
// development simulation is expected. The iOS app without the plugin (builds
// up to 5 have none) and the released site never offer the simulation: there
// the account is a guest id only, and nothing about it is shown.
export function createAccountForDevice(app, { box, newId } = {}) {
  const plugin = globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins?.SonmiraAppleSignIn : null;
  if (plugin) return Object.assign(createAccount({ apple: createNativeApple(plugin), remote: createHttpRemote(), box, newId }), { signInOffered: true });
  const acc = createAccount({ apple: createSimulatedApple({ ask: (req) => askAppleSimulator(app, req) }), remote: createSimulatedRemote(), box, newId });
  acc.signInOffered = !isNativeIOS() && !isReleaseSite();
  return acc;
}
