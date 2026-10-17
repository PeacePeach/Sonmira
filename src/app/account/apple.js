// The Sign in with Apple boundary on the phone. Its shape follows
// AuthenticationServices, so the native app puts the real thing behind it
// without touching the screens:
//
//   signIn({ nonce })        ASAuthorizationAppleIDProvider request, no scopes (no name, no email)
//                            → { status: 'success', user, identityToken, authorizationCode } | { status: 'cancelled' }
//   credentialState(user)    getCredentialState(forUserID:) → 'authorized' | 'revoked' | 'notFound' | 'transferred'
//
// Failures throw AppleError with a kind: 'network' | 'failed' | 'notAvailable'.
//
// Until the iOS shell exists, the only Apple here is the development
// simulation below. It never talks to Apple and every screen it touches says so.

export class AppleError extends Error {
  constructor(kind, message) { super(message || kind); this.kind = kind; }
}

/** Native: the SonmiraAppleSignIn Capacitor plugin (one Swift file beside the StoreKit plugin). */
export function createNativeApple(plugin) {
  return {
    simulated: false,
    async signIn({ nonce }) {
      try {
        const r = await plugin.signIn({ nonce });
        return r.cancelled ? { status: 'cancelled' } : { status: 'success', user: r.user, identityToken: r.identityToken, authorizationCode: r.authorizationCode };
      } catch (e) {
        // ASAuthorizationError: 1001 canceled, 1000 unknown (often no Apple ID), 1004 failed
        if (e?.code === '1001') return { status: 'cancelled' };
        if (e?.code === '1000') throw new AppleError('notAvailable');
        throw new AppleError(e?.code === 'network' ? 'network' : 'failed');
      }
    },
    async credentialState(user) { return (await plugin.credentialState({ user })).state; },
  };
}

const REVOKED = 'sonmira.sim.appleRevoked';
const readRevoked = () => { try { return JSON.parse(localStorage.getItem(REVOKED) || '[]'); } catch { return []; } };

/**
 * Development-only. `ask` shows the simulator sheet and resolves to what the
 * tester picks: 'new' | 'returning' | 'same' | 'other' | 'cancel' | 'network' | 'failed' | 'notAvailable' | 'serverDown'.
 */
export function createSimulatedApple({ ask }) {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return {
    simulated: true,
    /** purpose 'confirm' (before deleting) offers the signed-in Apple ID `user` or another one. */
    async signIn({ nonce, purpose = 'signIn', user: current }) {
      const outcome = await ask({ purpose });
      if (outcome === 'cancel') return { status: 'cancelled' };
      if (outcome === 'network' || outcome === 'failed' || outcome === 'notAvailable') throw new AppleError(outcome);
      const user = { returning: 'sim-returning', serverDown: 'sim-server-down', same: current }[outcome] || `sim-${rand()}`;
      return { status: 'success', user, identityToken: `sim.${user}.${nonce}`, authorizationCode: `sim-code-${rand()}` };
    },
    async credentialState(user) { return readRevoked().includes(user) ? 'revoked' : 'authorized'; },
    dev: {
      /** As if the person removed Sonmira under Settings → Apple ID → Sign in with Apple. */
      revoke(user) { try { localStorage.setItem(REVOKED, JSON.stringify([...new Set([...readRevoked(), user])])); } catch {} },
      forget() { try { localStorage.removeItem(REVOKED); } catch {} },
    },
  };
}
