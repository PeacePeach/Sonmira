// Checks that a StoreKit 2 transaction, renewal or App Store Server
// Notification was really signed by Apple for this app, with Apple's own
// library (@apple/app-store-server-library).
//
// Every Apple signature carries its certificate chain (x5c: leaf,
// intermediate, Apple Root CA - G3). The root is accepted only if its
// SHA-256 fingerprint is the pinned one below, so no certificate file has to
// be downloaded or configured.
//
// Production and Sandbox are both accepted: App Review and TestFlight buy in
// Sandbox against the production server. Xcode's local StoreKit testing
// signs with a local certificate and is accepted only when allowXcode is set
// (never in Production).

import { createHash } from 'node:crypto';
import { SignedDataVerifier, Environment } from '@apple/app-store-server-library';

// Apple Root CA - G3, https://www.apple.com/certificateauthority/
export const APPLE_ROOT_G3_SHA256 = '63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179';

export class AppleVerifyError extends Error {
  constructor(code, cause) { super(code); this.code = code; this.cause = cause; }
}

const ENV = { Production: Environment.PRODUCTION, Sandbox: Environment.SANDBOX, Xcode: Environment.XCODE };

function parts(jws) {
  const [h, p] = String(jws ?? '').split('.');
  try {
    return { header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')), payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) };
  } catch { throw new AppleVerifyError('malformed'); }
}

/**
 * @param {{ bundleId: string, appAppleId?: number|string, allowXcode?: boolean, roots?: string[] }} opts
 */
export function createAppleVerifier({ bundleId, appAppleId, allowXcode = false, roots = [APPLE_ROOT_G3_SHA256] }) {
  if (!bundleId) throw new Error('bundleId is required');
  const appId = appAppleId ? Number(appAppleId) : undefined;
  const cache = new Map();

  function verifierFor(jws, envName) {
    const environment = ENV[envName];
    if (!environment) throw new AppleVerifyError('bad_environment');
    if (environment === Environment.XCODE) {
      if (!allowXcode) throw new AppleVerifyError('xcode_not_allowed');
      return new SignedDataVerifier([], false, environment, bundleId);
    }
    if (environment === Environment.PRODUCTION && !appId) throw new AppleVerifyError('app_apple_id_missing');
    const root = Buffer.from(parts(jws).header.x5c?.[2] ?? '', 'base64');
    const fp = createHash('sha256').update(root).digest('hex').toUpperCase();
    if (!roots.includes(fp)) throw new AppleVerifyError('untrusted_root');
    const key = `${environment}:${fp}`;
    if (!cache.has(key)) cache.set(key, new SignedDataVerifier([root], false, environment, bundleId, environment === Environment.PRODUCTION ? appId : undefined));
    return cache.get(key);
  }

  const run = async (fn) => { try { return await fn(); } catch (e) { throw e instanceof AppleVerifyError ? e : new AppleVerifyError('invalid', e); } };

  return {
    /** → the decoded JWSTransaction (transactionId, productId, appAccountToken, expiresDate, revocationDate, …) */
    transaction: (jws) => run(() => verifierFor(jws, parts(jws).payload.environment).verifyAndDecodeTransaction(jws)),
    /** → the decoded JWSRenewalInfo (originalTransactionId, autoRenewStatus, gracePeriodExpiresDate, …) */
    renewal: (jws) => run(() => verifierFor(jws, parts(jws).payload.environment).verifyAndDecodeRenewalInfo(jws)),
    /** → the decoded notification; data.signedTransactionInfo / signedRenewalInfo still need transaction() / renewal(). */
    notification: (signedPayload) => run(() => {
      const p = parts(signedPayload).payload;
      return verifierFor(signedPayload, p.data?.environment ?? p.summary?.environment).verifyAndDecodeNotification(signedPayload);
    }),
  };
}

/**
 * Whether a verified StoreKit transaction was signed for the device whose
 * StoreKit device verification id (AppStore.deviceVerificationID) is given:
 * base64(SHA-384(nonce + id)), both lowercased, as Apple documents. A signed
 * transaction copied off someone else's device (a log, a screenshot) fails.
 */
export function onDevice(tx, deviceId) {
  const id = String(deviceId ?? '').toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(id) || !tx?.deviceVerification || !tx?.deviceVerificationNonce) return false;
  const want = createHash('sha384').update(String(tx.deviceVerificationNonce).toLowerCase() + id).digest('base64');
  return want === tx.deviceVerification;
}
