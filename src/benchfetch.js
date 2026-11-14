// bench-fetch: fetch the text of a real-world benchmark whose repository file holds only references.
//
// bench/github-real/ids.jsonl has one row per item and no text:
//   {"ref": "owner/repo#123", "gold": "T1", "label": "P0"}
// gold is the tier implied by the urgency label the maintainers applied (or the baseline for an item picked by
// a non-urgency label such as "enhancement"), label is the label that set it.
//
// The text goes to a cache outside the repository (cacheRoot()/github-real by default), as labelled JSONL that
// `urgent-first eval` reads. Every label is stripped from the items before they are written: the test is whether
// the rules recover the maintainers' urgency from the words alone, and the github-maintainer pack's label floor
// would otherwise read the answer ("P0", "regression", "security" set a tier by themselves).
//
// API budget: one request per (repository, label) list page, then one per item not found on the first pages;
// plus one per repository for its issue templates. Responses are cached, so a second run costs nothing.
import fs from 'node:fs';
import path from 'node:path';
import { UserError, readJsonl, toJsonl } from './util.js';
import { issueToRawItem } from './adapters/github.js';
import { cacheRoot, cachedFetch, fetchTemplates, budget } from './adapters/github-extra.js';

const API = 'https://api.github.com';
const REF_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/;

export function parseRef(ref) {
  const m = REF_RE.exec(String(ref || ''));
  if (!m || /^\.+$/.test(m[1]) || /^\.+$/.test(m[2])) throw new UserError(`Expected "owner/repo#number", got ${JSON.stringify(ref)}`);
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

export function readIds(file) {
  const rows = readJsonl(file);
  const seen = new Set();
  return rows.map((r, i) => {
    const where = `${path.basename(file)} line ${i + 1}`;
    if (!r || typeof r !== 'object') throw new UserError(`${where}: not an object`);
    const { owner, repo, number } = parseRef(r.ref);
    if (typeof r.gold !== 'string' || !r.gold) throw new UserError(`${where}: missing gold tier`);
    if (typeof r.label !== 'string' || !r.label) throw new UserError(`${where}: missing label`);
    if (seen.has(r.ref)) throw new UserError(`${where}: duplicate ref ${r.ref}`);
    seen.add(r.ref);
    const extra = Object.keys(r).filter((k) => !['ref', 'gold', 'label'].includes(k));
    if (extra.length) throw new UserError(`${where}: unexpected field(s) ${extra.join(', ')} (ids files hold only ref, gold and label)`);
    return { ref: r.ref, owner, repo, number, gold: r.gold, label: r.label };
  });
}

/**
 * The labelled item for one fetched issue, with every label removed and nothing that names one:
 * labels emptied, milestone dropped (a "release blocker" milestone would leak the answer).
 */
export function benchItem(issue, row) {
  const raw = issueToRawItem(issue, { owner: row.owner, repo: row.repo });
  raw.id = row.ref;
  raw.labels = [];
  delete raw.metadata.milestone;
  raw.gold = { tier: row.gold, category: `label:${row.label}`, rationale: `The maintainers applied the label "${row.label}".` };
  return raw;
}

/**
 * Fetch every row's issue. `fetchImpl` is the network fetch (tests pass a mock); responses are cached under
 * cacheDir/http. Returns { items, templates, missing, requests, remaining }.
 */
export async function benchFetch({ rows, token = null, fetchImpl = globalThis.fetch, cacheDir = path.join(cacheRoot(), 'github-real'), templates = true, maxPages = 3, log = () => {} }) {
  const b = budget();
  const cf = cachedFetch(fetchImpl, cacheDir, b);
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'urgent-first-bench' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const get = async (url) => {
    let res;
    try {
      res = await cf(url, { headers });
    } catch (err) {
      throw new UserError(`Cannot reach the GitHub API: ${err && err.message ? err.message : err}. Fetched responses are cached; run again to continue.`, { code: 3 });
    }
    if (!res.cached) {
      b.used++;
      const rem = res.headers.get('x-ratelimit-remaining');
      if (rem !== null) b.remaining = Number(rem);
    }
    if (res.status === 403 || res.status === 429) {
      throw new UserError(`GitHub API refused the request (HTTP ${res.status}) after ${b.used} request(s). Responses so far are cached; run again after the rate limit resets${token ? '' : ', or set GITHUB_TOKEN'}.`, { code: 3 });
    }
    if (!res.ok) return null;
    return res.json();
  };
  const found = new Map();
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.owner}/${r.repo}\u0000${r.label}`;
    if (!groups.has(k)) groups.set(k, { owner: r.owner, repo: r.repo, label: r.label, rows: [] });
    groups.get(k).rows.push(r);
  }
  for (const g of groups.values()) {
    const want = new Set(g.rows.map((r) => r.number));
    for (let page = 1; page <= maxPages && want.size; page++) {
      const url = `${API}/repos/${g.owner}/${g.repo}/issues?labels=${encodeURIComponent(g.label)}&state=all&sort=created&direction=desc&per_page=100&page=${page}`;
      const data = await get(url);
      if (!Array.isArray(data)) break;
      for (const issue of data) {
        if (issue && want.has(issue.number)) {
          found.set(`${g.owner}/${g.repo}#${issue.number}`, issue);
          want.delete(issue.number);
        }
      }
      if (data.length < 100) break;
    }
    log(`${g.owner}/${g.repo} label "${g.label}": ${g.rows.length - want.size}/${g.rows.length} from list pages`);
  }
  for (const r of rows) {
    if (found.has(r.ref)) continue;
    const issue = await get(`${API}/repos/${r.owner}/${r.repo}/issues/${r.number}`);
    if (issue && issue.number === r.number) found.set(r.ref, issue);
  }
  const items = [];
  const missing = [];
  for (const r of rows) {
    const issue = found.get(r.ref);
    if (!issue) missing.push(r.ref);
    else items.push(benchItem(issue, r));
  }
  const tpl = {};
  if (templates) {
    for (const repoKey of [...new Set(rows.map((r) => `${r.owner}/${r.repo}`))]) {
      const [owner, repo] = repoKey.split('/');
      const t = await fetchTemplates({ owner, repo, token, fetchImpl: async (url, opts) => {
        const res = await cf(url, opts);
        if (!res.cached && url.startsWith(API)) {
          b.used++;
          const rem = res.headers.get('x-ratelimit-remaining');
          if (rem !== null) b.remaining = Number(rem);
        }
        return { ...res, cached: true };
      }, cacheDir, b: null, maxAgeMs: Infinity });
      tpl[`github:${repoKey}`] = t.files;
    }
  }
  return { items, templates: tpl, missing, requests: b.used, remaining: b.remaining };
}

export function writeBenchOutput({ items, templates }, outFile) {
  const abs = path.resolve(outFile);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, toJsonl(items));
  const tplFile = abs.replace(/\.jsonl$/i, '') + '.templates.json';
  fs.writeFileSync(tplFile, JSON.stringify(templates, null, 2) + '\n');
  return { itemsFile: abs, templatesFile: tplFile };
}
