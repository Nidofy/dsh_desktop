import {readFile,stat} from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
import {getCACertificates} from 'node:tls';

// Node otherwise only warns about a missing NODE_EXTRA_CA_CERTS file and starts
// without it. Fail before DSH starts; a selected enterprise trust bundle must
// never silently turn into a different trust configuration.
export async function validateExtraCa(path = process.env.NODE_EXTRA_CA_CERTS) {
  if (!path) return;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size < 1 || info.size > 1024 * 1024) throw Error();
    const text = await readFile(path, 'utf8');
    const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    if (!blocks.length || /-----BEGIN (?:.* )?PRIVATE KEY-----/.test(text) || text.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,'').trim()) throw Error();
    const expected = blocks.map(block => new X509Certificate(block).fingerprint256);
    const loaded = new Set(getCACertificates('extra').map(block => new X509Certificate(block).fingerprint256));
    if (!expected.every(fingerprint => loaded.has(fingerprint))) throw Error();
  } catch {
    throw Error('Configured enterprise CA could not be validated and loaded; engine startup stopped.');
  }
}
