// GitHub issues and pull requests via the public REST API (no dependencies; global fetch).
//
// Unauthenticated requests are limited to 60 per hour. Set GITHUB_TOKEN or GH_TOKEN to raise the limit.
// Watch mode uses ETags (If-None-Match); a 304 answer means nothing changed.
// Tests never call the live API: pass `fetchImpl` to inject recorded responses.
import { UserError, VERSION } from '../util.js';

const API = 'https://api.github.com';

export function parseRepo(arg) {
  const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(arg || '').trim());
  // "." and ".." would be normalised away in the API URL ("/repos/../../issues" is "/issues").
  if (!m || /^\.+$/.test(m[1]) || /^\.+$/.test(m[2])) throw new UserError(`Expected owner/repo, got "${arg}"`);
  return { owner: m[1], repo: m[2] };
}

function headers(token, etag) {
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': `urgent-first/${VERSION}`,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  if (etag) h['If-None-Match'] = etag;
  return h;
}

export function tokenFromEnv(env = process.env) {
  return env.GITHUB_TOKEN || env.GH_TOKEN || null;
}

function rateInfo(res) {
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  return { remaining: remaining === null ? null : Number(remaining), reset: reset === null ? null : Number(reset) };
}

async function getJson(url, { token, fetchImpl, etag = null }) {
  let res;
  try {
    res = await fetchImpl(url, { headers: headers(token, etag) });
  } catch (err) {
    const cause = err && err.cause && err.cause.code ? ` (${err.cause.code})` : '';
    throw new UserError(`Cannot reach the GitHub API: ${err && err.message ? err.message : err}${cause}. Check the network connection and try again.`, { code: 3 });
  }
  const rate = rateInfo(res);
  if (res.status === 304) return { status: 304, data: null, etag, rate };
  if (res.status === 404) return { status: 404, data: null, etag: null, rate };
  if (res.status === 401) {
    throw new UserError('GitHub API rejected the token (HTTP 401). Check GITHUB_TOKEN or GH_TOKEN, or unset it to use the anonymous limit of 60 requests an hour.', { code: 3 });
  }
  if (res.status === 403 || res.status === 429) {
    const when = rate.reset ? new Date(rate.reset * 1000).toISOString() : null;
    const retry = res.headers.get('retry-after');
    const why =
      rate.remaining === 0
        ? `Rate limit reached${when ? `; it resets at ${when}` : ''}.`
        : retry
          ? `Secondary rate limit; retry after ${retry} s.`
          : 'Access denied or a secondary rate limit.';
    const hint = token ? 'Wait and try again.' : 'Set GITHUB_TOKEN or GH_TOKEN for 5,000 requests an hour instead of 60.';
    throw new UserError(`GitHub API refused the request (HTTP ${res.status}). ${why} ${hint}`, { code: 3 });
  }
  if (!res.ok) throw new UserError(`GitHub API error HTTP ${res.status} for ${url}`, { code: 3 });
  return { status: res.status, data: await res.json(), etag: res.headers.get('etag'), rate, link: res.headers.get('link') };
}

/** The rel="next" URL of a Link header, or null. */
export function nextLink(link) {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m && m[1].startsWith(API + '/')) return m[1];
  }
  return null;
}

export async function fetchLatestRelease({ owner, repo, token, fetchImpl }) {
  const r = await getJson(`${API}/repos/${owner}/${repo}/releases/latest`, { token, fetchImpl });
  if (r.status === 404 || !r.data) return null;
  return { tag: r.data.tag_name, published_at: r.data.published_at, url: r.data.html_url };
}

/**
 * Fetch open (or closed/all) issues and pull requests, newest first, up to `limit`.
 * Returns { rawItems, etag, rate, release }.
 */
export async function fetchIssues({ owner, repo, state = 'open', limit = 100, token = null, fetchImpl = globalThis.fetch, etag = null, includeRelease = true }) {
  if (!fetchImpl) throw new UserError('No fetch available (Node 18+ required)');
  const perPage = Math.min(100, Math.max(1, limit));
  const issues = [];
  // Pages are sorted by creation time, so an issue opened between two page requests pushes the last issue of
  // one page onto the next. Keep the first copy of each number instead of failing on a duplicate id.
  const seenNumbers = new Set();
  let firstEtag = null;
  let rate = null;
  let url = `${API}/repos/${owner}/${repo}/issues?state=${encodeURIComponent(state)}&sort=created&direction=desc&per_page=${perPage}`;
  for (let page = 1; url; page++) {
    const r = await getJson(url, { token, fetchImpl, etag: page === 1 ? etag : null });
    rate = r.rate;
    if (r.status === 404) throw new UserError(`Repository ${owner}/${repo} not found (or private without a token)`, { code: 3 });
    if (r.status === 304) return { notModified: true, rawItems: null, etag, rate, release: null };
    if (page === 1) firstEtag = r.etag;
    if (!Array.isArray(r.data)) throw new UserError(`Unexpected GitHub API answer for ${url}`, { code: 3 });
    for (const issue of r.data) {
      if (issue && seenNumbers.has(issue.number)) continue;
      if (issue) seenNumbers.add(issue.number);
      issues.push(issue);
    }
    if (issues.length >= limit || r.data.length < perPage) break;
    url = nextLink(r.link);
  }
  const release = includeRelease ? await fetchLatestRelease({ owner, repo, token, fetchImpl }) : null;
  const rawItems = issues.slice(0, limit).map((i) => issueToRawItem(i, { owner, repo, release }));
  return { notModified: false, rawItems, etag: firstEtag, rate, release };
}

export function issueToRawItem(issue, { owner, repo, release = null }) {
  const isPr = Boolean(issue.pull_request);
  const created = issue.created_at || null;
  const metadata = {
    type: isPr ? 'pull_request' : 'issue',
    number: issue.number,
    state: issue.state,
    comments: issue.comments ?? 0,
    reactions: issue.reactions?.total_count ?? 0,
    reactions_plus1: issue.reactions?.['+1'] ?? 0,
    author_association: issue.author_association || null,
    updated_at: issue.updated_at || null,
    draft: isPr ? Boolean(issue.draft) : undefined,
    milestone: issue.milestone?.title || null,
  };
  if (release) {
    metadata.latest_release = release.tag;
    metadata.latest_release_published_at = release.published_at;
    metadata.after_latest_release = Boolean(created && release.published_at && Date.parse(created) >= Date.parse(release.published_at));
  }
  for (const k of Object.keys(metadata)) if (metadata[k] === undefined) delete metadata[k];
  // The whole body (GitHub caps it at 65,536 characters): a cut would hide the end of a long report from the
  // rules and from the board without saying so.
  const body = typeof issue.body === 'string' ? issue.body : '';
  return {
    id: `#${issue.number}`,
    title: issue.title || '',
    text: { body },
    priority: null,
    labels: (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean),
    created_at: created,
    location: null,
    source: `github:${owner}/${repo}`,
    url: issue.html_url || null,
    synthetic: false,
    metadata,
  };
}
