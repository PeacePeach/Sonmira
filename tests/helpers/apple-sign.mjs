// A stand-in for Apple's signing chain, for tests: a root, an intermediate
// and a leaf with the same Apple-specific extensions, made with openssl, and
// ES256 JWS signed the way the App Store signs transactions. Tests trust this
// root by fingerprint instead of Apple's; nothing else in the verifier changes.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createPrivateKey, sign } from 'node:crypto';

export function testAppleChain() {
  const dir = mkdtempSync(join(tmpdir(), 'sonmira-apple-'));
  const p = (f) => join(dir, f);
  const ossl = (...a) => execFileSync('openssl', a, { stdio: 'pipe' });
  writeFileSync(p('ext.cnf'), [
    '[root]', 'basicConstraints=critical,CA:TRUE', 'keyUsage=critical,keyCertSign,cRLSign',
    '[inter]', 'basicConstraints=critical,CA:TRUE,pathlen:0', 'keyUsage=critical,keyCertSign,cRLSign', '1.2.840.113635.100.6.2.1=ASN1:NULL',
    '[leaf]', 'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature', '1.2.840.113635.100.6.11.1=ASN1:NULL', '',
  ].join('\n'));
  for (const n of ['root', 'inter', 'leaf']) ossl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', p(`${n}.key`));
  ossl('req', '-new', '-key', p('root.key'), '-subj', '/CN=Test Root', '-out', p('root.csr'), '-config', '/dev/null');
  ossl('x509', '-req', '-in', p('root.csr'), '-signkey', p('root.key'), '-set_serial', '1', '-days', '3650', '-out', p('root.pem'), '-extfile', p('ext.cnf'), '-extensions', 'root');
  for (const [n, issuer, cn] of [['inter', 'root', 'Test Intermediate'], ['leaf', 'inter', 'Test Leaf']]) {
    ossl('req', '-new', '-key', p(`${n}.key`), '-subj', `/CN=${cn}`, '-out', p(`${n}.csr`), '-config', '/dev/null');
    ossl('x509', '-req', '-in', p(`${n}.csr`), '-CA', p(`${issuer}.pem`), '-CAkey', p(`${issuer}.key`), '-set_serial', n === 'inter' ? '2' : '3', '-days', '3650', '-out', p(`${n}.pem`), '-extfile', p('ext.cnf'), '-extensions', n);
  }
  const der = (n) => ossl('x509', '-in', p(`${n}.pem`), '-outform', 'der');
  const x5c = ['leaf', 'inter', 'root'].map((n) => der(n).toString('base64'));
  const key = createPrivateKey(readFileSync(p('leaf.key')));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return {
    rootFingerprint: createHash('sha256').update(der('root')).digest('hex').toUpperCase(),
    sign(payload, { chain = x5c } = {}) {
      const input = `${b64({ alg: 'ES256', x5c: chain })}.${b64(payload)}`;
      return `${input}.${sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    },
    /** Xcode's local StoreKit signs with its own certificate; here, no chain at all. */
    unsigned(payload) { return `${b64({ alg: 'ES256' })}.${b64(payload)}.c2ln`; },
  };
}
