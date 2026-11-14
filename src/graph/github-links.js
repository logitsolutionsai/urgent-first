// Explicit GitHub references between items, parsed from the original text with exact offsets.
//
// `fixes`: a GitHub closing keyword (close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved;
// any case; an optional colon) directly followed by a reference, in a pull request's title or body. GitHub
// links and closes issues only from pull request descriptions and commits, so the same words in an issue are
// a `references` edge. https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
// `references`: any other reference, "#812", "acme/widget#812" or an https://github.com/<owner>/<repo>/(issues|pull)/812
// URL. "related to #812", "see #812" and "mentions #812" are references, never fixes.
// Text inside HTML comments (template guidance), fenced code blocks and inline code is not read: an example
// "Fixes #123" in a template is not a link. Offsets are into the original field, so text.slice(start, end)
// always equals the quote.
// Fixed regular expressions only; nothing is compiled from item text.

const CLOSING = 'close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved';
// A reference: owner/repo#N, #N, or a github.com issue or pull request URL.
const REF = String.raw`(?:(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+))?#(?<num>\d{1,9})(?![\w-])|https:\/\/github\.com\/(?<uowner>[A-Za-z0-9_.-]+)\/(?<urepo>[A-Za-z0-9_.-]+)\/(?:issues|pull)\/(?<unum>\d{1,9})(?![\w/-])`;
const FIX_RE = new RegExp(String.raw`(?<![\w-])(?<kw>${CLOSING})\s*:?\s+(?<ref>${REF})`, 'giu');
const REF_RE = new RegExp(String.raw`(?<![\w&/#])(?<ref>${REF})`, 'gu');

/** Blank HTML comments, fenced code blocks and inline code with spaces, keeping length and newlines. */
export function blankNonProse(text) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, blank)
    .replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1?\2[^\n]*$|(?![\s\S]))/gm, blank)
    .replace(/`[^`\n]+`/g, blank);
}

function target(groups) {
  const owner = groups.owner || groups.uowner || null;
  const repo = groups.repo || groups.urepo || null;
  const num = Number(groups.num || groups.unum);
  return { owner, repo, number: num };
}

/**
 * Parse one item's explicit references.
 * @param {{title: string, text: object, kind: string}} item snapshot item (kind "pull_request" may fix)
 * @param {string} repository "owner/repo" of the item, or null for non-GitHub items
 * @returns {{type: 'fixes'|'references', number, repository, field, start, end, text, keyword?}[]}
 */
export function parseReferences(item, repository) {
  const out = [];
  const fields = [['title', item.title || ''], ...Object.entries(item.text || {})];
  for (const [field, raw] of fields) {
    if (typeof raw !== 'string' || !raw.includes('#') && !raw.includes('github.com')) continue;
    const scan = field === 'title' ? raw : blankNonProse(raw);
    const taken = [];
    for (const m of scan.matchAll(FIX_RE)) {
      const t = target(m.groups);
      const repoName = t.owner ? `${t.owner}/${t.repo}` : repository;
      const type = item.kind === 'pull_request' ? 'fixes' : 'references';
      out.push({ type, number: t.number, repository: repoName, field, start: m.index, end: m.index + m[0].length, text: raw.slice(m.index, m.index + m[0].length), keyword: m.groups.kw });
      taken.push([m.index, m.index + m[0].length]);
    }
    for (const m of scan.matchAll(REF_RE)) {
      const s = m.index;
      const e = s + m[0].length;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      const t = target(m.groups);
      out.push({ type: 'references', number: t.number, repository: t.owner ? `${t.owner}/${t.repo}` : repository, field, start: s, end: e, text: raw.slice(s, e) });
    }
  }
  return out.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : a.start - b.start));
}
