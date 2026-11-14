// Canonical JSON and content digests for snapshots, evidence graphs and pulses.
//
// canonicalJson(): object keys sorted by UTF-16 code unit order at every depth, arrays kept in their order,
// no whitespace, `undefined` members dropped (as JSON.stringify does). Numbers use JSON.stringify's shortest
// round-trip form, so the same value always gives the same bytes. Two values with the same canonical JSON have
// the same digest; nothing else about the serialisation (indentation, key order on disk, line endings) matters.
import crypto from 'node:crypto';

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function sha256(text) {
  return `sha256:${crypto.createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export function digestOf(value) {
  return sha256(canonicalJson(value));
}

/** A short, deterministic id: prefix + the first 16 hex digits of the digest of `parts`. */
export function shortId(prefix, parts) {
  return `${prefix}-${digestOf(parts).slice(7, 23)}`;
}
