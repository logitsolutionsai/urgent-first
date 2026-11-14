// A fetch replacement that serves recorded GitHub API responses from a folder (tests and offline demos).
// Folder layout: index.json maps "METHOD path?query" (path without https://api.github.com) to a file and
// headers: { "GET /repos/acme/widget/issues?...": { "status": 200, "file": "issues-page1.json", "headers": {...} } }
// A request carrying If-None-Match equal to the entry's etag gets a 304, as the real API does.
// Query parameters are matched exactly; an entry key may use "*" to match any query string.
import fs from 'node:fs';
import path from 'node:path';

export function fixtureFetch(dir) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const calls = [];
  const impl = async (url, opts = {}) => {
    const u = new URL(url);
    const key = `GET ${u.pathname}${u.search}`;
    const wildcard = `GET ${u.pathname}*`;
    const entry = index[key] || index[wildcard];
    const reqHeaders = opts.headers || {};
    calls.push({ url, headers: reqHeaders });
    const make = (status, body, headers = {}) => ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      json: async () => JSON.parse(body),
    });
    if (!entry) return make(404, '{"message":"Not Found"}', { 'x-ratelimit-remaining': '59' });
    const headers = Object.fromEntries(Object.entries(entry.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    if (entry.etag) headers.etag = entry.etag;
    if (entry.etag && reqHeaders['If-None-Match'] === entry.etag) return make(304, '', headers);
    const body = entry.file ? fs.readFileSync(path.join(dir, entry.file), 'utf8') : JSON.stringify(entry.body ?? null);
    return make(entry.status ?? 200, body, headers);
  };
  impl.calls = calls;
  return impl;
}
