// GitHub extras: repository issue and pull request templates (for masking), issues linked from pull requests
// ("Fixes #N") that are not in the run, and a small on-disk cache outside any repository.
//
// API budget: templates cost one API request per repository (the contents listing of .github/ISSUE_TEMPLATE)
// and are cached for a day; the files themselves, and the single-file templates in .github, the root and docs/,
// come from raw.githubusercontent.com, which is not counted against the API rate limit.
// Linked issues cost one request each, capped by the caller.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { VERSION } from '../util.js';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Root of urgent-first's cache: URGENT_FIRST_CACHE, else the platform's user cache folder. Never inside a repository. */
export function cacheRoot(env = process.env) {
  if (env.URGENT_FIRST_CACHE) return path.resolve(env.URGENT_FIRST_CACHE);
  if (process.platform === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'urgent-first', 'cache');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'urgent-first');
  return path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'urgent-first');
}

function apiHeaders(token) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': `urgent-first/${VERSION}` };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Counts API requests and remembers the last x-ratelimit-remaining. */
export function budget(limit = Infinity) {
  return { limit, used: 0, remaining: null, rawUsed: 0 };
}

async function apiGet(url, { token, fetchImpl, b }) {
  if (b && b.used >= b.limit) return { status: 0, data: null, skipped: true };
  if (b && b.remaining !== null && b.remaining <= 1) return { status: 0, data: null, skipped: true };
  let res;
  try {
    res = await fetchImpl(url, { headers: apiHeaders(token) });
  } catch {
    return { status: 0, data: null };
  }
  if (b && !res.cached) {
    b.used++;
    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem !== null) b.remaining = Number(rem);
  }
  if (!res.ok) return { status: res.status, data: null };
  return { status: res.status, data: await res.json() };
}

async function rawGet(url, { fetchImpl, b }) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': `urgent-first/${VERSION}` } });
  } catch {
    return null;
  }
  if (b) b.rawUsed++;
  if (!res.ok) return null;
  return typeof res.text === 'function' ? res.text() : JSON.stringify(await res.json());
}

const ROOT_CANDIDATES = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE.md',
  '.github/issue_template.md',
  'ISSUE_TEMPLATE.md',
  'issue_template.md',
  'docs/ISSUE_TEMPLATE.md',
  'docs/issue_template.md',
];

/**
 * Fetch a repository's issue and pull request templates: [{path, content}].
 * One API request (the .github/ISSUE_TEMPLATE listing); the files and the single-file variants in .github, the
 * root and docs/ are read from raw.githubusercontent.com.
 * Cached per repository for a day under cacheRoot()/templates. Failures give an empty list, never an error:
 * masking is a refinement and the board must not depend on it.
 */
export async function fetchTemplates({ owner, repo, token = null, fetchImpl = globalThis.fetch, cacheDir = cacheRoot(), b = null, maxAgeMs = DAY_MS, now = Date.now() }) {
  const file = cacheDir ? path.join(cacheDir, 'templates', `${owner}__${repo}.json`) : null;
  if (file) try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cached && Array.isArray(cached.files) && now - Date.parse(cached.fetched_at) < maxAgeMs) return { files: cached.files, cached: true };
  } catch {
    // no usable cache
  }
  const files = [];
  const seen = new Set();
  const addDir = async (dir) => {
    const r = await apiGet(`${API}/repos/${owner}/${repo}/contents/${dir}`, { token, fetchImpl, b });
    if (!Array.isArray(r.data)) return r;
    for (const f of r.data) {
      if (!f || f.type !== 'file' || !/\.(md|ya?ml)$/i.test(f.name) || /^config\.ya?ml$/i.test(f.name)) continue;
      const url = typeof f.download_url === 'string' && f.download_url.startsWith(RAW + '/') ? f.download_url : `${RAW}/${owner}/${repo}/HEAD/${dir}/${f.name}`;
      const content = await rawGet(url, { fetchImpl, b });
      if (content !== null && !seen.has(f.path || `${dir}/${f.name}`)) {
        seen.add(f.path || `${dir}/${f.name}`);
        files.push({ path: f.path || `${dir}/${f.name}`, content });
      }
    }
    return r;
  };
  const issueDir = await addDir('.github/ISSUE_TEMPLATE');
  if (issueDir.skipped) return { files: [], cached: false, skipped: true };
  // Raw files are outside the API limit: ask for every candidate at once and keep them in a fixed order.
  const raws = await Promise.all(ROOT_CANDIDATES.map((p) => rawGet(`${RAW}/${owner}/${repo}/HEAD/${p}`, { fetchImpl, b })));
  ROOT_CANDIDATES.forEach((p, i) => {
    // A template may start with an HTML comment; an HTML page is an error page, not a template.
    if (raws[i] !== null && !/^\s*<(?:!doctype|html)/i.test(raws[i])) files.push({ path: p, content: raws[i] });
  });
  if (file) try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ owner, repo, fetched_at: new Date(now).toISOString(), files }, null, 2) + '\n');
  } catch {
    // a read-only cache folder only costs a refetch next time
  }
  return { files, cached: false };
}

/** Issue numbers a pull request links with "Fixes #N" (pack.inherit.regex) that are not in the run. */
export function missingLinkedNumbers(items, pack) {
  if (!pack.inherit) return [];
  const have = new Set(items.map((it) => (it.metadata && Number.isInteger(it.metadata.number) ? it.metadata.number : null)).filter((n) => n !== null));
  const re = new RegExp(pack.inherit.regex, 'giu');
  const want = new Set();
  for (const it of items) {
    if (!it.metadata || it.metadata.type !== 'pull_request') continue;
    for (const text of [it.title, ...Object.values(it.text)]) {
      if (typeof text !== 'string') continue;
      for (const m of text.matchAll(re)) {
        const n = Number(m[1]);
        if (Number.isInteger(n) && !have.has(n)) want.add(n);
      }
    }
  }
  return [...want].sort((a, b) => a - b);
}

/** Fetch single issues by number, at most `max`, stopping when the rate limit runs low. Returns raw API issues. */
export async function fetchIssuesByNumber({ owner, repo, numbers, token = null, fetchImpl = globalThis.fetch, max = 10, b = null, reserve = 5 }) {
  const out = [];
  for (const n of numbers.slice(0, max)) {
    if (b && b.remaining !== null && b.remaining <= reserve) break;
    const r = await apiGet(`${API}/repos/${owner}/${repo}/issues/${n}`, { token, fetchImpl, b });
    if (r.skipped) break;
    if (r.data && typeof r.data === 'object' && r.data.number === n) out.push(r.data);
  }
  return out;
}

/** A JSON response cache keyed by URL, for bench-fetch (cacheDir/http/<sha1>.json). */
export function cachedFetch(fetchImpl, cacheDir, b = null) {
  const dir = path.join(cacheDir, 'http');
  return async (url, opts = {}) => {
    const key = crypto.createHash('sha1').update(url).digest('hex');
    const file = path.join(dir, `${key}.json`);
    if (fs.existsSync(file)) {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      const headers = c.headers || {};
      return { status: c.status, ok: c.status >= 200 && c.status < 300, cached: true, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => c.body, text: async () => (typeof c.body === 'string' ? c.body : JSON.stringify(c.body)) };
    }
    const res = await fetchImpl(url, opts);
    if (b) b.network = (b.network || 0) + 1;
    const isJson = url.startsWith(API);
    const body = res.ok ? (isJson ? await res.json() : await res.text()) : null;
    const headers = {};
    for (const h of ['x-ratelimit-remaining', 'x-ratelimit-reset', 'link', 'etag']) {
      const v = res.headers.get(h);
      if (v !== null) headers[h] = v;
    }
    if (res.ok || res.status === 404) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ url, status: res.status, headers, body, fetched_at: new Date().toISOString() }) + '\n');
    }
    return { status: res.status, ok: res.ok, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
}
