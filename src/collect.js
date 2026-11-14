// GitHub collection shared by the github and snapshot commands: issues and pull requests, then the
// repository templates (for masking) and the issues linked from pull requests. Moved out of cli.js unchanged
// (tests/run-golden.test.js keeps the github command's run folder byte-identical).
import { UserError } from './util.js';
import { normalizeItems } from './items.js';
import { issueToRawItem } from './adapters/github.js';
import { fetchTemplates, missingLinkedNumbers, fetchIssuesByNumber, cacheRoot, budget } from './adapters/github-extra.js';

/**
 * Repository templates for masking and issues linked from pull requests ("Fixes #N") that are not in the run.
 * Both are refinements: they stay within the API budget (templates: one request per repository, cached for a
 * day; linked issues: at most --linked-max, default 10, and never the last 10 requests of the hour).
 */
export async function githubExtras({ pack, owner, repo, items, token, fetchImpl, flags, rate }) {
  const b = budget();
  b.remaining = rate?.remaining ?? null;
  const fixture = Boolean(process.env.URGENT_FIRST_GITHUB_FIXTURE);
  let templates = null;
  let templateFiles = [];
  if (pack.masking && pack.mode !== 'research' && !flags.noTemplates) {
    const t = await fetchTemplates({ owner, repo, token, fetchImpl, b, cacheDir: fixture ? null : cacheRoot() });
    templateFiles = t.files.map((f) => f.path);
    templates = { [`github:${owner}/${repo}`]: t.files };
  }
  let linked = [];
  const maxLinked = flags.linkedMax === undefined ? 10 : Number(flags.linkedMax);
  if (!Number.isInteger(maxLinked) || maxLinked < 0 || maxLinked > 100) throw new UserError('--linked-max must be an integer from 0 to 100');
  if (pack.inherit && maxLinked > 0) {
    const numbers = missingLinkedNumbers(items, pack);
    if (numbers.length) {
      const raw = await fetchIssuesByNumber({ owner, repo, numbers, token, fetchImpl, max: maxLinked, b, reserve: 10 });
      linked = normalizeItems(raw.map((i) => issueToRawItem(i, { owner, repo })), 'linked issue');
    }
  }
  return { templates, templateFiles, linked, b };
}

