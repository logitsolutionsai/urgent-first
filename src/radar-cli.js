// Maintainer Radar commands: snapshot, links, diff, digest, review, calibrate, pack lint.
// Additive to src/cli.js; the existing commands and their exit codes are unchanged.
// Exit codes follow the existing table: 0 ok (a partial snapshot is still 0, with status "partial" and a
// warning), 1 usage or input error (including a snapshot that fails verification or an invalid review file),
// 2 refused (research-mode packs, unsafe public export), 3 network or GitHub API, 4 a --strict check failed.
import fs from 'node:fs';
import path from 'node:path';
import { UserError, VERSION, readJson, readJsonl, clip } from './util.js';
import { loadPack } from './pack.js';
import { loadItems } from './adapters/index.js';
import { normalizeItems, stripGold } from './items.js';
import { triage } from './engine.js';
import { parseRepo, fetchIssues, tokenFromEnv } from './adapters/github.js';
import { fixtureFetch } from './adapters/github-fixture.js';
import { githubExtras } from './collect.js';
import { buildSnapshot, prepareOutDir, writeAtomic, stableJson, loadSnapshot, isResearchPack } from './snapshot/snapshot.js';
import { warning } from './diagnostics.js';
import { sharedWords } from './pulse/diff.js';

function out(s = '') {
  process.stdout.write(s + '\n');
}

function need(positional, n, usage) {
  if (positional.length < n) throw new UserError(`Usage: ${usage}`);
}

/**
 * Clinical isolation: Maintainer Radar features never operate on research-mode packs (radiology-research or
 * any pack with mode "research" or researchOnly). The existing one-off `run` on synthetic data is unchanged.
 */
export function refuseResearch(pack, what) {
  if (isResearchPack(pack)) {
    throw new UserError(`Pack "${pack.name}" runs in research mode: ${what} is disabled. Maintainer Radar features (snapshot, links, diff, digest, review, calibrate, public export) never operate on research packs. Use "urgent-first run" on synthetic data for a one-off board.`, { code: 2 });
  }
}

function getFetch() {
  const fixture = process.env.URGENT_FIRST_GITHUB_FIXTURE;
  return fixture ? fixtureFetch(fixture) : globalThis.fetch;
}

function writeSnapshotFolder(outDir, snap, collection, { force, graph = null }) {
  const dir = prepareOutDir(outDir, { marker: 'snapshot.json', force, what: 'snapshot' });
  writeAtomic(dir, 'snapshot.json', stableJson(snap));
  writeAtomic(dir, 'collection.json', JSON.stringify(collection, null, 2) + '\n');
  if (graph) writeAtomic(dir, 'evidence-graph.json', stableJson(graph));
  return dir;
}

function defaultSnapshotDir(name, snap) {
  return path.join(process.cwd(), 'urgent-first-snapshots', `${name}-${snap.snapshotId.slice(7, 19)}`);
}

let graphBuilder = null;
/** The evidence graph builder (src/graph/build.js), loaded lazily so snapshot works on its own. */
async function buildGraphFor(snap) {
  if (!graphBuilder) graphBuilder = await import('./graph/build.js');
  return graphBuilder.buildGraph(snap);
}

function printSnapshotSummary(snap, dir, flags) {
  if (flags.json) {
    out(JSON.stringify({ schemaVersion: 1, kind: 'urgent-first-snapshot-result', snapshotId: snap.snapshotId, status: snap.status, dir, counts: snap.counts, source: snap.source, release: snap.release || null, warnings: snap.warnings }, null, 2));
    return;
  }
  const c = snap.counts;
  out(`Snapshot ${snap.snapshotId}`);
  out(`  status ${snap.status}${snap.status === 'partial' ? ` (${snap.source.reason}): totals cover only what was collected` : ''}`);
  out(`  pack ${snap.pack.id} ${snap.pack.version} (${snap.pack.digest.slice(0, 19)})`);
  out(`  items ${c.total} · Discuss First ${c.flagged} (${Object.entries(c.by_tier).slice(0, -1).map(([t, n]) => `${t} ${n}`).join(', ')}) · No rule matched ${c.unmatched}`);
  if (snap.release) out(`  latest release ${snap.release.tag} published ${snap.release.publishedAt} (from the GitHub API)`);
  for (const w of snap.warnings) out(`  ${w.severity}: ${w.code}: ${w.message}`);
  out(`Folder: ${dir}`);
}

async function snapshotGithub({ positional, flags }) {
  need(positional, 1, 'urgent-first snapshot github <owner/repo> [--pack github-maintainer] [--state open|closed|all] [--limit N] [--out DIR] [--force]');
  const { owner, repo } = parseRepo(positional[0]);
  const pack = loadPack(flags.pack || 'github-maintainer');
  refuseResearch(pack, 'snapshot github');
  const limit = flags.limit ? Number(flags.limit) : 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 30000) throw new UserError('--limit must be an integer from 1 to 30000');
  const state = flags.state || 'open';
  if (!['open', 'closed', 'all'].includes(state)) throw new UserError('--state must be open, closed or all');
  const token = tokenFromEnv();
  const fetchImpl = getFetch();
  const started = Date.now();
  const fetched = await fetchIssues({ owner, repo, state, limit, token, fetchImpl, allowPartial: true });
  if (fetchImpl.synthetic) for (const r of fetched.rawItems) r.synthetic = true;
  const items = normalizeItems(fetched.rawItems, 'issue').map(stripGold);
  const extras = await githubExtras({ pack, owner, repo, items, token, fetchImpl, flags, rate: fetched.rate, release: fetched.release });
  const result = triage(items, pack, { now: null, inputLabel: `github:${owner}/${repo}`, templates: extras.templates, linked: extras.linked });
  const stop = fetched.partial || fetched.truncated;
  const source = {
    kind: 'github',
    repository: `${owner}/${repo}`,
    scope: { state, limit },
    complete: !stop,
    ...(stop ? { reason: stop.reason, continuation: stop.continuation || null } : {}),
    pageCount: fetched.pages,
    templateFiles: extras.templateFiles,
    linkedIssuesFetched: extras.linked.length,
  };
  const warnings = [];
  if (fetched.releaseError) warnings.push(warning('unknown_release', `The latest-release request failed (${fetched.releaseError.reason}); no release marker is shown.`));
  const release = fetched.release ? { tag: fetched.release.tag, publishedAt: fetched.release.published_at, source: 'github-release-api', url: fetched.release.url || null } : null;
  const snap = buildSnapshot({ pack, items, result, source, release, warnings });
  const graph = await buildGraphFor(snap);
  const counts = [extras.b.remaining, fetched.rate?.remaining].filter((x) => x !== null && x !== undefined);
  const collection = {
    schemaVersion: 1,
    kind: 'urgent-first-collection',
    engineVersion: VERSION,
    snapshotId: snap.snapshotId,
    command: 'snapshot github',
    collectedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    recordedFixture: Boolean(fetchImpl.recorded),
    tokenUsed: Boolean(token),
    rateRemaining: counts.length ? Math.min(...counts) : null,
    etag: fetched.etag || null,
    ...(fetched.partial ? { stoppedBy: { reason: fetched.partial.reason, message: fetched.partial.message, ...(fetched.partial.retryAfterSeconds !== undefined ? { retryAfterSeconds: fetched.partial.retryAfterSeconds } : {}) } } : {}),
  };
  const dir = writeSnapshotFolder(flags.out || defaultSnapshotDir(`${pack.name}-${owner}-${repo}`, snap), snap, collection, { force: Boolean(flags.force), graph });
  printSnapshotSummary(snap, dir, flags);
  return 0;
}

async function snapshotRun({ positional, flags }) {
  need(positional, 2, 'urgent-first snapshot run <pack> <input> [--out DIR] [--force]');
  const pack = loadPack(positional[0]);
  refuseResearch(pack, 'snapshot');
  const started = Date.now();
  const { items: loaded, warnings: loadWarnings } = loadItems(positional[1], { format: flags.format || 'auto' });
  const items = loaded.map(stripGold);
  const templates = typeof flags.templates === 'string' ? readJson(flags.templates) : null;
  const result = triage(items, pack, { now: null, inputLabel: path.basename(positional[1]), templates });
  const source = { kind: 'file', input: path.basename(positional[1]), format: flags.format || 'auto', scope: { kind: 'file' }, complete: true };
  const warnings = loadWarnings.map((w) => warning('input_warning', w));
  const snap = buildSnapshot({ pack, items, result, source, release: null, warnings });
  const graph = await buildGraphFor(snap);
  const collection = { schemaVersion: 1, kind: 'urgent-first-collection', engineVersion: VERSION, snapshotId: snap.snapshotId, command: 'snapshot run', collectedAt: new Date().toISOString(), durationMs: Date.now() - started, recordedFixture: false };
  const dir = writeSnapshotFolder(flags.out || defaultSnapshotDir(pack.name, snap), snap, collection, { force: Boolean(flags.force), graph });
  printSnapshotSummary(snap, dir, flags);
  return 0;
}

export async function cmdSnapshot(args) {
  const [sub, ...rest] = args.positional;
  const next = { positional: rest, flags: args.flags };
  if (sub === 'github') return snapshotGithub(next);
  if (sub === 'run') return snapshotRun(next);
  throw new UserError('Usage: urgent-first snapshot github <owner/repo> [...] | urgent-first snapshot run <pack> <input> [...]');
}

/** links <snapshot>: the evidence graph, recomputed from snapshot.json and checked. */
export async function cmdLinks({ positional, flags }) {
  need(positional, 1, 'urgent-first links <snapshot-dir> [--json] [--include-near]');
  const { snapshot, graph: stored, dir } = loadSnapshot(positional[0]);
  refuseResearch({ name: snapshot.pack.id, mode: snapshot.pack.mode }, 'links');
  const { buildGraph } = await import('./graph/build.js');
  const { validateGraph } = await import('./graph/validate.js');
  const graph = buildGraph(snapshot, { includeNear: Boolean(flags.includeNear) });
  const problems = validateGraph(graph, snapshot);
  if (problems.length) throw new UserError('The evidence graph failed its integrity checks', { details: problems });
  const storedDiffers = stored && !flags.includeNear && stableJson(stored) !== stableJson(graph);
  if (flags.json) {
    out(stableJson(graph).trimEnd());
    return 0;
  }
  const byType = {};
  for (const e of graph.edges) byType[e.type] = (byType[e.type] || 0) + 1;
  const local = new Map(snapshot.items.map((i) => [i.id, i]));
  const label = (id) => {
    const si = local.get(id);
    return si ? `${si.localId} "${clip(si.title, 50)}"` : id;
  };
  out(`Evidence graph of ${snapshot.snapshotId} (${snapshot.items.length} items)`);
  out(`  edges: ${Object.entries(byType).sort().map(([t, n]) => `${t} ${n}`).join(', ') || 'none'}`);
  for (const e of graph.edges.filter((x) => x.type === 'fixes' || x.type === 'references')) out(`  ${e.type.padEnd(18)} ${label(e.from)} -> ${label(e.to)}  quote "${e.quotes[0].text}"`);
  out('Related reports (candidates: they may describe the same problem; every member keeps its own tier and place):');
  if (!graph.clusters.length) out('  none');
  for (const c of graph.clusters) {
    out(`  ${label(c.anchor)}`);
    for (const m of c.members) {
      const e = graph.edges.find((x) => x.id === m.edge);
      out(`    ${m.type === 'possible_duplicate' ? 'may describe the same problem' : 'same error signature'}: ${label(m.id)}  score ${m.score} (ranking signal, not a probability)  shared: ${sharedWords(e).slice(0, 6).join(', ')}`);
    }
  }
  for (const s of graph.suppressedCandidates) out(`  not linked (conflicting evidence): ${label(s.from)} and ${label(s.to)}: ${s.conflicts.map((c) => `${c.ruleId} affirmed "${c.affirmed.text}" vs negated "${c.negated.text}"`).join('; ')}`);
  for (const w of graph.warnings) out(`  ${w.severity}: ${w.code}: ${w.message}`);
  if (storedDiffers) out(`  note: ${path.join(dir, 'evidence-graph.json')} differs from the recomputed graph (written by another version?)`);
  return 0;
}

function readGold(file) {
  const rows = readJsonl(file);
  const gold = new Map();
  for (const r of rows) if (r && r.id !== undefined && r.gold && r.gold.tier) gold.set(String(r.id), r.gold.tier);
  if (!gold.size) throw new UserError(`${file} has no rows with id and gold.tier`);
  return gold;
}

function snapshotPackGuard(snap, what) {
  refuseResearch({ name: snap.pack.id, mode: snap.pack.mode }, what);
}

function parseFormats(value) {
  const list = typeof value === 'string' ? value.split(',').map((x) => x.trim()).filter(Boolean) : ['md', 'html', 'json'];
  for (const f of list) if (!['md', 'html', 'json'].includes(f)) throw new UserError(`--format takes md, html and json (got "${f}")`);
  return list;
}

/** diff <older> <newer>: the Release Pulse. Read-only on both snapshots; writes only into --out. */
export async function cmdDiff({ positional, flags }) {
  need(positional, 2, 'urgent-first diff <older-snapshot> <newer-snapshot> [--out DIR] [--json] [--gold FILE] [--public [--allow-real-public-export]]');
  const older = loadSnapshot(positional[0]);
  const newer = loadSnapshot(positional[1]);
  snapshotPackGuard(older.snapshot, 'diff');
  snapshotPackGuard(newer.snapshot, 'diff');
  const { diffSnapshots, publicProjection } = await import('./pulse/diff.js');
  const { renderPulseMarkdown, renderPulseHtml } = await import('./pulse/render.js');
  const { buildGraph } = await import('./graph/build.js');
  if (flags.allowRealPublicExport && !flags.public) throw new UserError('--allow-real-public-export only makes sense with --public');
  const gold = typeof flags.gold === 'string' ? readGold(flags.gold) : null;
  let pulse = diffSnapshots(older.snapshot, newer.snapshot, { newerGraph: buildGraph(newer.snapshot), gold });
  if (flags.public) pulse = publicProjection(pulse, { allowReal: Boolean(flags.allowRealPublicExport), olderSnap: older.snapshot, newerSnap: newer.snapshot });
  const md = renderPulseMarkdown(pulse);
  if (typeof flags.out === 'string') {
    const dir = prepareOutDir(flags.out, { marker: 'pulse.json', force: Boolean(flags.force), what: 'pulse' });
    writeAtomic(dir, 'pulse.json', stableJson(pulse));
    writeAtomic(dir, 'pulse.md', md);
    writeAtomic(dir, 'pulse.html', renderPulseHtml(pulse));
    if (!flags.json) out(`Pulse: ${path.join(dir, 'pulse.md')}\nHTML:  ${path.join(dir, 'pulse.html')}\nJSON:  ${path.join(dir, 'pulse.json')}`);
  }
  if (flags.json) out(stableJson(pulse).trimEnd());
  else if (typeof flags.out !== 'string') out(md.trimEnd());
  else {
    const c = pulse.counts;
    out(`${c.newlyFlagged} newly flagged · ${c.tierChanges} tier change(s) · ${c.unresolvedPrior} still open from before · ${c.clustersWithNewMembers} related group(s) with new members · status ${pulse.status}`);
    for (const w of pulse.warnings) out(`  ${w.severity}: ${w.code}: ${w.message}`);
  }
  return 0;
}

/** digest <snapshot>: Discuss First, Related Reports, Since Last Snapshot. */
export async function cmdDigest({ positional, flags }) {
  need(positional, 1, 'urgent-first digest <snapshot> [--previous DIR] [--out DIR] [--format md,html,json] [--force]');
  const cur = loadSnapshot(positional[0]);
  snapshotPackGuard(cur.snapshot, 'digest');
  const formats = parseFormats(flags.format);
  const { buildDigest } = await import('./pulse/digest.js');
  const { renderDigestMarkdown, renderDigestHtml } = await import('./pulse/render.js');
  let since = null;
  if (typeof flags.previous === 'string') {
    const prev = loadSnapshot(flags.previous);
    snapshotPackGuard(prev.snapshot, 'digest');
    const { diffSnapshots } = await import('./pulse/diff.js');
    const { buildGraph } = await import('./graph/build.js');
    since = diffSnapshots(prev.snapshot, cur.snapshot, { newerGraph: buildGraph(cur.snapshot) });
  }
  const digest = buildDigest(cur.snapshot, { since });
  const md = renderDigestMarkdown(digest);
  if (typeof flags.out === 'string') {
    const dir = prepareOutDir(flags.out, { marker: 'digest.json', force: Boolean(flags.force), what: 'digest' });
    // digest.json is always written: it marks the folder and is the machine-readable source of the other two.
    writeAtomic(dir, 'digest.json', stableJson(digest));
    if (formats.includes('md')) writeAtomic(dir, 'digest.md', md);
    if (formats.includes('html')) writeAtomic(dir, 'digest.html', renderDigestHtml(digest));
    out(`Digest: ${[...new Set(['json', ...formats])].map((f) => path.join(dir, `digest.${f}`)).join(', ')}`);
    return 0;
  }
  out(flags.json ? stableJson(digest).trimEnd() : md.trimEnd());
  return 0;
}

/** review init <snapshot> --out FILE | review check <review.json> <snapshot> [--json] */
export async function cmdReview({ positional, flags }) {
  const [sub, ...rest] = positional;
  const { initReview, checkReview } = await import('./review/review.js');
  const { buildGraph } = await import('./graph/build.js');
  if (sub === 'init') {
    need(rest, 1, 'urgent-first review init <snapshot> --out FILE [--reviewer ALIAS] [--force]');
    if (typeof flags.out !== 'string') throw new UserError('review init needs --out FILE (for example reviews/maintainer.json)');
    const { snapshot } = loadSnapshot(rest[0]);
    snapshotPackGuard(snapshot, 'review');
    const review = initReview(snapshot, buildGraph(snapshot), { reviewer: typeof flags.reviewer === 'string' ? flags.reviewer : 'maintainer' });
    const target = path.resolve(flags.out);
    if (fs.existsSync(target) && !flags.force) throw new UserError(`${target} exists. Use --force to replace it.`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeAtomic(path.dirname(target), path.basename(target), JSON.stringify(review, null, 2) + '\n');
    out(`Review file: ${target} (${review.decisions.length} target(s) to review; decisions start as null)`);
    return 0;
  }
  if (sub === 'check') {
    need(rest, 2, 'urgent-first review check <review.json> <snapshot> [--json]');
    const review = readJson(rest[0]);
    const { snapshot } = loadSnapshot(rest[1]);
    snapshotPackGuard(snapshot, 'review');
    const res = checkReview(review, snapshot, buildGraph(snapshot));
    if (flags.json) out(JSON.stringify({ schemaVersion: 1, kind: 'urgent-first-review-check', valid: res.valid, errors: res.errors, counts: res.counts }, null, 2));
    else {
      out(`${res.valid ? 'Valid' : 'Invalid'} review: ${res.counts.reviewed ?? 0} decision(s) reviewed, ${res.counts.unreviewed ?? 0} not reviewed yet.`);
      for (const e of res.errors) out(`  ${e.code}${e.index !== undefined ? ` (decision ${e.index + 1})` : ''}: ${e.message}`);
      out('Decisions are annotations: they never change the snapshot, the board or the pack.');
    }
    return res.valid ? 0 : 1;
  }
  throw new UserError('Usage: urgent-first review init <snapshot> --out FILE | urgent-first review check <review.json> <snapshot> [--json]');
}

/** calibrate <pack> <review.json> --snapshot DIR --out DIR: a proposal, never an applied change. */
export async function cmdCalibrate({ positional, flags }) {
  need(positional, 2, 'urgent-first calibrate <pack> <review.json> --snapshot DIR --out DIR [--heldout FILE[,FILE]] [--json] [--strict]');
  const pack = loadPack(positional[0]);
  refuseResearch(pack, 'calibrate');
  if (typeof flags.snapshot !== 'string') throw new UserError('calibrate needs --snapshot DIR: the snapshot the review was made on');
  if (typeof flags.out !== 'string') throw new UserError('calibrate needs --out DIR for the proposal');
  const outAbs = path.resolve(flags.out);
  const { PACKS_DIR } = await import('./pack.js');
  for (const guarded of [pack._dir, PACKS_DIR].filter(Boolean)) {
    const rel = path.relative(path.resolve(guarded), outAbs);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new UserError(`Refusing to write a proposal inside ${guarded}: a proposal never touches a pack folder.`, { code: 2 });
  }
  const { snapshot } = loadSnapshot(flags.snapshot);
  snapshotPackGuard(snapshot, 'calibrate');
  const { checkReview } = await import('./review/review.js');
  const { buildGraph } = await import('./graph/build.js');
  const { proposePatch } = await import('./review/propose-pack.js');
  const checked = checkReview(readJson(positional[1]), snapshot, buildGraph(snapshot));
  if (!checked.valid) throw new UserError('The review file is invalid; run urgent-first review check first', { details: checked.errors.map((e) => `${e.code}: ${e.message}`) });
  let heldout = typeof flags.heldout === 'string' ? flags.heldout.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (!heldout.length && pack._dir) {
    const def = path.join(pack._dir, '..', '..', 'bench', pack.name, 'test.jsonl');
    if (fs.existsSync(def)) heldout = [def];
  }
  const res = proposePatch({ pack, snapshot, checked, heldoutFiles: heldout });
  const dir = prepareOutDir(flags.out, { marker: 'proposal.json', force: Boolean(flags.force), what: 'proposal' });
  writeAtomic(dir, 'proposal.json', JSON.stringify(res.proposal, null, 2) + '\n');
  writeAtomic(dir, 'candidate-pack.json', JSON.stringify(res.candidateRaw, null, 2) + '\n');
  writeAtomic(dir, 'dev-cases.jsonl', res.cases.map((c) => JSON.stringify(c)).join('\n') + (res.cases.length ? '\n' : ''));
  const p = res.proposal;
  if (flags.json) out(JSON.stringify(p, null, 2));
  else {
    const ev = p.evaluation;
    if (ev && ev.development) out(`Development cases: missed top tier before ${ev.development.before.missed_top_tier.length ? ev.development.before.missed_top_tier.join(', ') : 'none'}; after ${ev.development.after.missed_top_tier.length ? ev.development.after.missed_top_tier.join(', ') : 'none'}`);
    if (ev && ev.heldout) out(`Held-out (${p.heldoutFiles.join(', ')}): missed top tier before ${ev.heldout.before.missed_top_tier.length}, after ${ev.heldout.after.missed_top_tier.length}; false flags ${ev.heldout.before.false_flags} -> ${ev.heldout.after.false_flags}; verdict ${ev.verdict}`);
    out(`Proposed rule change(s): ${p.proposedRules.length} (${p.proposedRules.map((r) => `${r.action} ${r.id}`).join(', ') || 'none'})`);
    for (const w of p.warnings) out(`  warning: ${w.code}: ${w.message}`);
    out(`Proposal (not active, nothing applied): ${dir}`);
  }
  return flags.strict && p.evaluation && p.evaluation.verdict === 'regression' ? 4 : 0;
}

/** pack lint <pack> [--json] [--strict] */
export async function cmdPack({ positional, flags }) {
  const [sub, ...rest] = positional;
  if (sub !== 'lint') throw new UserError('Usage: urgent-first pack lint <pack> [--json] [--strict]');
  need(rest, 1, 'urgent-first pack lint <pack> [--json] [--strict]');
  const { lintPack } = await import('./pack-lint.js');
  const r = lintPack(rest[0]);
  if (flags.json) out(JSON.stringify(r, null, 2));
  else {
    if (r.pack.mode === 'research') out('RESEARCH MODE pack: lint only reads it; Maintainer Radar features never run on it.\n');
    out(`${r.ok ? 'OK' : 'ERRORS'}: pack ${r.pack.name} ${r.pack.version}: ${r.errors.length} error(s), ${r.warnings.length} warning(s); fixtures ${r.checked.fixtures.join(', ') || 'none'}`);
    for (const e of r.errors) out(`  error ${e.code}: ${e.message}`);
    for (const w of r.warnings) out(`  warning ${w.code}: ${w.message}`);
  }
  if (!r.ok) return 1;
  return flags.strict && r.warnings.length ? 4 : 0;
}

export { out, need, loadSnapshot, clip, fs };
