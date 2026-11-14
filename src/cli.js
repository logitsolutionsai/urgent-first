// Command-line interface. Exit codes: 0 ok, 1 usage or input error, 2 validation refused,
// 3 network error, 4 a --strict check failed.
import fs from 'node:fs';
import path from 'node:path';
import { UserError, VERSION, readJsonl, readJson, writeInside, toJsonl, parseTime, formatMinutes, clip, readText } from './util.js';
import { loadPack, listPacks, packReviewGuide, PACKS_DIR, RESEARCH_BANNER } from './pack.js';
import { loadItems } from './adapters/index.js';
import { normalizeItems } from './items.js';
import { executeRun, loadRun, writeBoards, defaultRunDir, prepareRunDir } from './run.js';
import { triage } from './engine.js';
import { mergeAnnotations, reviewTemplate } from './annotate.js';
import { evaluateLabelled, formatEvalText } from './eval.js';
import { parseRepo, fetchIssues, tokenFromEnv } from './adapters/github.js';
import { prepareItem, evaluate } from './match/conditions.js';
import { tokenize } from './match/text.js';
import { computeContext } from './match/context.js';
import { recordShadow, shadowReport } from './shadow.js';
import { fixtureFetch } from './adapters/github-fixture.js';
import { cacheRoot } from './adapters/github-extra.js';
import { githubExtras } from './collect.js';
import { cmdSnapshot, cmdLinks, cmdDiff, cmdDigest, cmdReview, cmdCalibrate, cmdPack } from './radar-cli.js';
import { readIds, benchFetch, writeBenchOutput } from './benchfetch.js';

const HELP = `urgent-first ${VERSION}: urgent items first, by rules you write.

Usage:
  urgent-first run <pack> <input> [--out DIR] [--now ISO] [--format auto|jsonl|json|csv|fhir|hl7]
  urgent-first github <owner/repo> [--pack github-maintainer] [--state open|closed|all] [--limit N]
                      [--out DIR] [--watch] [--interval SECONDS] [--no-templates] [--linked-max N]
  urgent-first watch <pack> <file-or-dir> [--out DIR] [--interval SECONDS] [--polls N]
  urgent-first seen <run>                       mark everything on the board as seen ("last look")
  urgent-first annotate-template <run> [--only-unmatched]  write review.md and review.jsonl for an agent
  urgent-first merge <run> <annotations.jsonl> [--strict]
  urgent-first eval <pack> <labelled.jsonl> [--annotations FILE] [--templates FILE] [--json] [--strict]
  urgent-first bench-fetch <ids.jsonl> [--out FILE] [--cache DIR]   fetch a real-world benchmark's text (labels stripped)
  urgent-first shadow <run> --picks ID [ID ...] [--note TEXT]
  urgent-first shadow-report <run>
  urgent-first explain <pack> "<text>"          show how rules and negation read one sentence
  urgent-first explain <run> --item ID          show how one item of a run was read, masked text included
  urgent-first validate <pack>                  check a pack against schema/pack.schema.json
  urgent-first new-pack <dir> [--name NAME]     start a pack from a commented template
  urgent-first packs                            list bundled packs

Maintainer Radar (read-only; never on research packs; docs/MAINTAINER-RADAR.md):
  urgent-first snapshot github <owner/repo> [--pack P] [--state S] [--limit N] [--out DIR] [--force] [--json]
  urgent-first snapshot run <pack> <input> [--out DIR] [--force] [--templates FILE] [--json]
  urgent-first links <snapshot> [--json] [--include-near]
  urgent-first diff <older-snapshot> <newer-snapshot> [--out DIR] [--json] [--gold FILE] [--public [--allow-real-public-export]]
  urgent-first digest <snapshot> [--previous DIR] [--out DIR] [--format md,html,json]
  urgent-first review init <snapshot> --out FILE [--reviewer ALIAS]
  urgent-first review check <review.json> <snapshot> [--json]
  urgent-first calibrate <pack> <review.json> --snapshot DIR --out DIR [--heldout FILE] [--json] [--strict]
  urgent-first pack lint <pack> [--json] [--strict]
There is no apply command: this release never writes to GitHub (docs/THREAT-MODEL.md).

<pack> is a bundled pack name (${listPacks().join(', ') || 'none found'}) or a folder with pack.json.
Every flag quotes the exact words behind it. Nothing is ever placed below the tier its own priority implies.
Items no rule matched are listed in original order: that does not mean they are not urgent.`;

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const multi = new Set(['picks']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = (eq > 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (eq > 0) {
        flags[key] = a.slice(eq + 1);
        continue;
      }
      if (multi.has(key)) {
        const vals = [];
        while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) vals.push(...argv[++i].split(',').map((s) => s.trim()).filter(Boolean));
        flags[key] = vals;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && !BOOLEAN_FLAGS.has(key)) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

const BOOLEAN_FLAGS = new Set(['json', 'strict', 'watch', 'onlyUnmatched', 'help', 'version', 'quiet', 'noTemplates', 'force', 'includeNear', 'public', 'allowRealPublicExport']);

function nowFrom(flags) {
  if (flags.now) {
    if (parseTime(flags.now) === null) throw new UserError(`--now "${flags.now}" is not an ISO 8601 date-time`);
    return new Date(parseTime(flags.now)).toISOString();
  }
  return new Date().toISOString();
}

function need(positional, n, usage) {
  if (positional.length < n) throw new UserError(`Usage: ${usage}`);
}

function summaryLines(result, { max = 12, newIds = null } = {}) {
  const L = [];
  const c = result.counts;
  const tiers = result.pack.tiers;
  const baseline = tiers[tiers.length - 1].id;
  L.push(`Discuss First: ${c.flagged} (${tiers.filter((t) => t.id !== baseline).map((t) => `${t.id} ${c.by_tier[t.id]}`).join(', ')}) · No rule matched: ${c.unmatched} · Items: ${c.total}`);
  const flagged = result.items.filter((r) => r.tier !== baseline);
  for (const r of flagged.slice(0, max)) {
    const first = r.rules[0] || null;
    const ann = r.annotations.find((a) => a.applied) || null;
    const why = first ? `${first.id} "${clip(first.evidence[0].text, 60)}"` : ann ? `${ann.rule_id} "${clip(ann.quotes[0], 60)}"` : r.floor.reasons.length ? `floor ${r.floor.reasons[0].kind} "${r.floor.reasons[0].evidence[0].text}"` : '';
    L.push(`  ${r.tier}  ${r.id}  ${clip(r.title, 60)}  [${why}]${newIds && newIds.has(r.id) ? '  NEW' : ''}`);
  }
  if (flagged.length > max) L.push(`  ... and ${flagged.length - max} more on the board`);
  return L;
}

function out(s = '') {
  process.stdout.write(s + '\n');
}

function researchNotice(pack) {
  if (pack.mode === 'research') out(`RESEARCH MODE: ${pack.banner}\n`);
}

/** The banner for commands that only have a run folder (shadow, shadow-report). */
function runResearchNotice(dir) {
  const f = path.join(path.resolve(dir), 'run.json');
  if (fs.existsSync(f) && readJson(f).mode === 'research') out(`RESEARCH MODE: ${RESEARCH_BANNER}\n`);
}

async function cmdRun({ positional, flags }) {
  need(positional, 2, 'urgent-first run <pack> <input> [--out DIR]');
  const pack = loadPack(positional[0]);
  const now = nowFrom(flags);
  const { items, warnings } = loadItems(positional[1], { format: flags.format || 'auto' });
  const outDir = flags.out || defaultRunDir(pack.name, now);
  researchNotice(pack);
  const r = executeRun({ pack, items, outDir, now, inputLabel: path.basename(positional[1]) });
  for (const w of warnings) out(`warning: ${w}`);
  for (const line of summaryLines(r.result)) out(line);
  out('');
  out(`Board: ${path.join(r.dir, 'board.md')}`);
  out(`HTML:  ${path.join(r.dir, 'board.html')}`);
  out(`Next:  urgent-first annotate-template "${r.dir}"`);
  return 0;
}

function getFetch() {
  const fixture = process.env.URGENT_FIRST_GITHUB_FIXTURE;
  return fixture ? fixtureFetch(fixture) : globalThis.fetch;
}

async function cmdGithub({ positional, flags }) {
  need(positional, 1, 'urgent-first github <owner/repo> [--pack github-maintainer]');
  const { owner, repo } = parseRepo(positional[0]);
  const pack = loadPack(flags.pack || 'github-maintainer');
  if (flags.watch && pack.mode === 'research') throw new UserError(`Pack "${pack.name}" runs in research mode: watch is disabled.`, { code: 2 });
  const limit = flags.limit ? Number(flags.limit) : 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new UserError('--limit must be an integer from 1 to 1000');
  const state = flags.state || 'open';
  if (!['open', 'closed', 'all'].includes(state)) throw new UserError('--state must be open, closed or all');
  const token = tokenFromEnv();
  const fetchImpl = getFetch();
  const now = nowFrom(flags);
  const outDir = flags.out || defaultRunDir(`${pack.name}-${owner}-${repo}`, now);
  const fetched = await fetchIssues({ owner, repo, state, limit, token, fetchImpl });
  const items = normalizeItems(fetched.rawItems, 'issue');
  const extras = await githubExtras({ pack, owner, repo, items, token, fetchImpl, flags, rate: fetched.rate, release: fetched.release });
  const r = executeRun({ pack, items, outDir, now, inputLabel: `github:${owner}/${repo} (${state}, ${items.length})`, templates: extras.templates, linked: extras.linked, extra: { github: { owner, repo, state, limit, etag: fetched.etag, latest_release: fetched.release?.tag ?? null, template_files: extras.templateFiles, linked_fetched: extras.linked.length } } });
  // The lowest count seen: a response served from a cache or a fixture can carry an older, higher count.
  const counts = [extras.b.remaining, fetched.rate?.remaining].filter((x) => x !== null && x !== undefined);
  const left = counts.length ? Math.min(...counts) : null;
  out(`${owner}/${repo}: ${items.length} ${state} issues and pull requests${fetched.release ? ` · latest release ${fetched.release.tag}` : ''}${left !== null && left !== undefined ? ` · API requests left this hour: ${left}` : ''}`);
  const mk = maskingLine(r.result, extras);
  if (mk) out(mk);
  for (const line of summaryLines(r.result)) out(line);
  out('');
  out(`Board: ${path.join(r.dir, 'board.md')}`);
  out(`HTML:  ${path.join(r.dir, 'board.html')}`);
  if (!flags.watch) return 0;
  return watchGithub({ pack, owner, repo, state, limit, token, fetchImpl, dir: r.dir, initial: r, etag: fetched.etag, release: fetched.release, flags, templates: extras.templates });
}

function maskingLine(result, extras) {
  const m = result.masking;
  if (!m) return null;
  const inheriting = result.links ? result.links.pull_requests_inheriting : 0;
  if (!extras.templateFiles.length && !m.template_lines_masked && !m.boilerplate_lines_masked && !inheriting) return null;
  const parts = [];
  parts.push(`${extras.templateFiles.length} template file(s)`);
  parts.push(`${m.template_lines_masked} template and ${m.boilerplate_lines_masked} boilerplate line(s) masked in ${m.items_masked} item(s), shown dimmed and not read by rules`);
  if (result.links && result.links.pull_requests_inheriting) parts.push(`${result.links.pull_requests_inheriting} pull request(s) take the tier of the issue they fix${extras.linked.length ? ` (${extras.linked.length} linked issue(s) fetched)` : ''}`);
  return `Masking: ${parts.join(' · ')}`;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function watchStatePath(dir) {
  return path.join(dir, 'watch-state.json');
}

function readWatchState(dir) {
  const f = watchStatePath(dir);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function refreshBoard({ pack, items, dir, now, inputLabel, state, quiet, templates = null }) {
  const result = triage(items, pack, { now, inputLabel, templates });
  const lastLook = new Set(state.last_look_ids);
  const announced = new Set(state.announced_ids || []);
  const newIds = new Set(items.filter((it) => !lastLook.has(it.id)).map((it) => it.id));
  const baseline = pack._baseline;
  const fresh = result.items.filter((r) => newIds.has(r.id) && !announced.has(r.id));
  for (const r of fresh) {
    announced.add(r.id);
    if (r.tier !== baseline && !quiet) {
      const first = r.rules[0];
      out(`[${now}] NEW ${r.tier} ${r.id} ${clip(r.title, 70)}${first ? `  ${first.id} "${clip(first.evidence[0].text, 60)}"` : ''}`);
    }
  }
  const fullState = { ...state, announced_ids: [...announced], updated_at: now, item_ids: items.map((i) => i.id) };
  writeInside(dir, 'items.json', JSON.stringify(items, null, 2) + '\n');
  writeInside(dir, 'results.rules.json', JSON.stringify(result, null, 2) + '\n');
  writeInside(dir, 'results.json', JSON.stringify(result, null, 2) + '\n');
  writeBoards(dir, result, pack, items, { newIds });
  writeInside(dir, 'watch-state.json', JSON.stringify(fullState, null, 2) + '\n');
  return { result, newIds, fresh, state: fullState };
}

async function watchGithub({ pack, owner, repo, state, limit, token, fetchImpl, dir, initial, etag, release, flags, templates = null }) {
  const interval = Number(flags.interval || (token ? 60 : 120));
  const polls = flags.polls ? Number(flags.polls) : Infinity;
  let ws = readWatchState(dir) || { last_look_ids: initial.items.map((i) => i.id), announced_ids: initial.items.map((i) => i.id) };
  writeInside(dir, 'watch-state.json', JSON.stringify(ws, null, 2) + '\n');
  out(`Watching ${owner}/${repo} every ${interval} s (conditional requests; a 304 answer is free). Ctrl+C to stop.`);
  let currentEtag = etag;
  for (let i = 0; i < polls; i++) {
    await sleep(interval * 1000);
    const now = new Date().toISOString();
    let fetched;
    try {
      fetched = await fetchIssues({ owner, repo, state, limit, token, fetchImpl, etag: currentEtag, includeRelease: false });
    } catch (err) {
      out(`[${now}] ${err.message}`);
      continue;
    }
    if (fetched.notModified) continue;
    currentEtag = fetched.etag;
    if (release) fetched.rawItems.forEach((r) => Object.assign(r.metadata, { latest_release: release.tag, latest_release_published_at: release.published_at, after_latest_release: Boolean(r.created_at && Date.parse(r.created_at) >= Date.parse(release.published_at)) }));
    const items = normalizeItems(fetched.rawItems, 'issue');
    const res = refreshBoard({ pack, items, dir, now, inputLabel: `github:${owner}/${repo}`, state: ws, quiet: flags.quiet, templates });
    ws = res.state;
    out(`[${now}] board updated: ${res.result.counts.flagged} in Discuss First, ${res.newIds.size} new since last look`);
  }
  return 0;
}

async function cmdWatch({ positional, flags }) {
  need(positional, 2, 'urgent-first watch <pack> <file-or-dir>');
  const pack = loadPack(positional[0]);
  if (pack.mode === 'research') {
    throw new UserError(`Pack "${pack.name}" runs in research mode: watch is disabled. Research packs produce one-off boards on synthetic data only, with no live updates and no notifications.`, { code: 2 });
  }
  const target = positional[1];
  const interval = Number(flags.interval || 5);
  const polls = flags.polls ? Number(flags.polls) : Infinity;
  const now0 = nowFrom(flags);
  const outDir = flags.out || defaultRunDir(`${pack.name}-watch`, now0);
  const dir = prepareRunDir(outDir);
  let lastSig = null;
  let ws = readWatchState(dir);
  const label = path.basename(target);
  const signature = () => {
    const st = fs.statSync(target);
    if (!st.isDirectory()) return `${st.size}:${st.mtimeMs}`;
    return fs.readdirSync(target).sort().map((f) => {
      const s = fs.statSync(path.join(target, f));
      return `${f}:${s.size}:${s.mtimeMs}`;
    }).join('|');
  };
  out(`Watching ${target} every ${interval} s. Board: ${path.join(dir, 'board.md')}. Ctrl+C to stop.`);
  for (let i = 0; ; i++) {
    let sig;
    try {
      sig = signature();
    } catch (err) {
      out(`cannot read ${target}: ${err.message}`);
      sig = null;
    }
    if (sig !== null && sig !== lastSig) {
      lastSig = sig;
      try {
        const { items } = loadItems(target, { format: flags.format || 'auto' });
        const now = i === 0 ? now0 : new Date().toISOString();
        if (!ws) {
          ws = { last_look_ids: items.map((x) => x.id), announced_ids: items.map((x) => x.id) };
          writeInside(dir, 'run.json', JSON.stringify({ tool: 'urgent-first', version: VERSION, pack: pack.name, pack_version: pack.version, pack_file: pack._file, mode: pack.mode, input: label, now, watch: true }, null, 2) + '\n');
        }
        const res = refreshBoard({ pack, items, dir, now, inputLabel: label, state: ws, quiet: flags.quiet });
        ws = res.state;
        if (i === 0) for (const line of summaryLines(res.result)) out(line);
        else out(`[${now}] board updated: ${res.result.counts.flagged} in Discuss First, ${res.newIds.size} new since last look`);
      } catch (err) {
        if (!(err instanceof UserError)) throw err;
        out(`input not usable yet: ${err.message}`);
      }
    }
    if (i + 1 >= polls) break;
    await sleep(interval * 1000);
  }
  return 0;
}

async function cmdSeen({ positional }) {
  need(positional, 1, 'urgent-first seen <run>');
  const dir = path.resolve(positional[0]);
  const { run, items } = loadRun(dir);
  const ws = readWatchState(dir) || {};
  ws.last_look_ids = items.map((i) => i.id);
  ws.announced_ids = [...new Set([...(ws.announced_ids || []), ...ws.last_look_ids])];
  ws.last_look_at = new Date().toISOString();
  writeInside(dir, 'watch-state.json', JSON.stringify(ws, null, 2) + '\n');
  const pack = loadPack(run.pack_file || run.pack);
  const current = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  writeBoards(dir, current, pack, items, { newIds: new Set() });
  out(`Marked ${items.length} item(s) as seen. "New since last look" starts from now.`);
  return 0;
}

async function cmdAnnotateTemplate({ positional, flags }) {
  need(positional, 1, 'urgent-first annotate-template <run>');
  const { dir, run, items, rules } = loadRun(positional[0]);
  const pack = loadPack(run.pack_file || run.pack);
  const itemsById = new Map(items.map((it) => [it.id, it]));
  const guide = packReviewGuide(pack);
  const tpl = reviewTemplate(rules, itemsById, pack, { guidePath: guide, onlyUnmatched: Boolean(flags.onlyUnmatched) });
  writeInside(dir, 'review.md', tpl.markdown + '\n');
  writeInside(dir, 'review.jsonl', toJsonl(tpl.rows));
  if (!fs.existsSync(path.join(dir, 'annotations.jsonl'))) writeInside(dir, 'annotations.jsonl', '');
  researchNotice(pack);
  out(`${tpl.rows.length} item(s) need review.`);
  out(`Review list: ${path.join(dir, 'review.md')}`);
  if (guide) out(`Pack guidance: ${guide}`);
  out(`Write annotations to: ${path.join(dir, 'annotations.jsonl')}`);
  out(`Then: urgent-first merge "${dir}" "${path.join(dir, 'annotations.jsonl')}"`);
  return 0;
}

async function cmdMerge({ positional, flags }) {
  need(positional, 2, 'urgent-first merge <run> <annotations.jsonl>');
  const { dir, run, items, rules } = loadRun(positional[0]);
  const pack = loadPack(run.pack_file || run.pack);
  const raw = readJsonl(positional[1]);
  const itemsById = new Map(items.map((it) => [it.id, it]));
  const merged = mergeAnnotations(rules, pack, raw, itemsById);
  writeInside(dir, 'results.json', JSON.stringify(merged, null, 2) + '\n');
  writeInside(dir, 'annotations.report.json', JSON.stringify(merged.annotations, null, 2) + '\n');
  writeBoards(dir, merged, pack, items);
  researchNotice(pack);
  const a = merged.annotations;
  out(`Annotations: ${a.accepted} accepted (${a.applied} raised a tier), ${a.rejected} rejected.`);
  for (const x of a.rejected_list) out(`  rejected line ${x.line} (${x.item_id}): ${x.reasons.join('; ')}`);
  for (const line of summaryLines(merged)) out(line);
  out('');
  out(`Board: ${path.join(dir, 'board.md')}`);
  out(`HTML:  ${path.join(dir, 'board.html')}`);
  return flags.strict && a.rejected ? 4 : 0;
}

async function cmdEval({ positional, flags }) {
  need(positional, 2, 'urgent-first eval <pack> <labelled.jsonl>');
  const pack = loadPack(positional[0]);
  const { items } = loadItems(positional[1], { format: flags.format || 'auto' });
  const annotations = flags.annotations ? readJsonl(flags.annotations) : null;
  const templates = typeof flags.templates === 'string' ? readJson(flags.templates) : null;
  const report = evaluateLabelled(items, pack, { annotations, templates, now: flags.now ? nowFrom(flags) : null, inputLabel: path.basename(positional[1]) });
  if (flags.json) out(JSON.stringify(report, null, 2));
  else {
    if (pack.mode === 'research') out(`RESEARCH MODE: ${pack.banner}\n`);
    out(formatEvalText(report, pack));
  }
  const final = report.with_annotations || report.rules_only;
  return flags.strict && final.missed_critical.length ? 4 : 0;
}

async function cmdShadow({ positional, flags }) {
  need(positional, 1, 'urgent-first shadow <run> --picks ID [ID ...]');
  const picks = Array.isArray(flags.picks) ? flags.picks : typeof flags.picks === 'string' ? flags.picks.split(',') : [];
  if (!picks.length) throw new UserError('Give the expert\'s own first picks in order: --picks ID [ID ...]');
  const { dir, current } = loadRun(positional[0]);
  runResearchNotice(dir);
  const entry = recordShadow(dir, current, picks, { note: typeof flags.note === 'string' ? flags.note : null });
  out(`Recorded ${picks.length} pick(s). Top-${picks.length} overlap with the board: ${entry.overlap_at_k}/${picks.length}. Picks in Discuss First: ${entry.picks_flagged}/${picks.length}.`);
  if (entry.unknown_ids.length) out(`  not on this board: ${entry.unknown_ids.join(', ')}`);
  if (entry.top_tier_not_picked.length) out(`  ${current.pack.tiers[0].id} on the board but not picked: ${entry.top_tier_not_picked.join(', ')}`);
  if (entry.picked_not_flagged.length) out(`  picked but no rule matched: ${entry.picked_not_flagged.join(', ')} (candidates for a new rule)`);
  out('');
  out(shadowReport(dir));
  return 0;
}

async function cmdShadowReport({ positional }) {
  need(positional, 1, 'urgent-first shadow-report <run>');
  runResearchNotice(positional[0]);
  out(shadowReport(path.resolve(positional[0])));
  return 0;
}

async function cmdBenchFetch({ positional, flags }) {
  need(positional, 1, 'urgent-first bench-fetch <ids.jsonl> [--out FILE] [--cache DIR]');
  const rows = readIds(positional[0]);
  const cacheDir = typeof flags.cache === 'string' ? path.resolve(flags.cache) : path.join(cacheRoot(), 'github-real');
  const outFile = typeof flags.out === 'string' ? flags.out : path.join(cacheDir, 'items.jsonl');
  const token = tokenFromEnv();
  out(`Fetching ${rows.length} item(s) from ${new Set(rows.map((r) => `${r.owner}/${r.repo}`)).size} repositories${token ? ' (token set)' : ' (no token: 60 API requests an hour)'}. Cache: ${cacheDir}`);
  const res = await benchFetch({ rows, token, fetchImpl: globalThis.fetch, cacheDir, templates: !flags.noTemplates, log: out });
  const files = writeBenchOutput(res, outFile);
  out(`Fetched ${res.items.length} of ${rows.length}; every label stripped. API requests made: ${res.requests}${res.remaining !== null ? `, left this hour: ${res.remaining}` : ''}.`);
  for (const m of res.missing) out(`  missing (deleted, transferred or private): ${m}`);
  out(`Items:     ${files.itemsFile}`);
  out(`Templates: ${files.templatesFile}`);
  out(`Next:      urgent-first eval github-maintainer "${files.itemsFile}" --templates "${files.templatesFile}"`);
  return res.missing.length ? 4 : 0;
}

function explainRunItem(dir, id) {
  const { run, items, current } = loadRun(dir);
  const item = items.find((x) => x.id === id);
  const r = current.items.find((x) => x.id === id);
  if (!item || !r) throw new UserError(`No item ${JSON.stringify(id)} in ${dir}`);
  out(`${r.id} ${r.title}`);
  out(r.explanation);
  for (const rule of r.rules) {
    out(`  ${rule.id} (${rule.tier}): ${rule.evidence.map((e) => `"${e.text}" [${e.field}]`).join(', ')}`);
    for (const l of rule.linked || []) out(`    linked ${l.id} "${clip(l.title, 60)}" is ${l.tier} by ${l.by.join(', ') || 'its floor'}`);
  }
  const masked = r.masked || [];
  if (!masked.length) out(current.masking ? 'Masked: nothing (every line of this item was read by the rules)' : `Masked: nothing (pack ${run.pack} does not mask, or masking was off)`);
  else {
    out(`Masked (template text, not read by rules): ${masked.length} line(s)`);
    for (const m of masked) out(`  ${m.kind.padEnd(11)} ${m.field}[${m.start}:${m.end}] "${clip(String(item.text[m.field] || '').slice(m.start, m.end).trim(), 80)}"`);
  }
  return 0;
}

async function cmdExplain({ positional, flags }) {
  if (positional.length === 1 && typeof flags.item === 'string') return explainRunItem(positional[0], flags.item);
  need(positional, 2, 'urgent-first explain <pack> "<text>"');
  const pack = loadPack(positional[0]);
  const text = positional.slice(1).join(' ');
  researchNotice(pack);
  const item = normalizeItems([{ id: 'explain', title: '', text: { text }, synthetic: true, priority: pack.floor.missing_priority === 'error' ? Object.keys(pack.floor.priority).slice(-1)[0] || null : null }])[0];
  const tokens = tokenize(text, pack._abbrevs);
  const ctx = computeContext(tokens, pack._cues, { window: pack.matching.window });
  out('Cues found:');
  for (const c of ctx.cues) out(`  ${c.kind.padEnd(6)} "${text.slice(tokens[c.a].s, tokens[c.b].e)}"`);
  out('Words and their context:');
  const words = tokens.filter((t) => t.k === 'w');
  const line = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.k !== 'w') continue;
    const tag = ctx.susp[i] ? 'S' : ctx.neg[i] ? 'N' : ctx.hist[i] ? 'H' : '';
    line.push(tag ? `${t.t}/${tag}` : t.t);
  }
  out(`  ${line.join(' ')}`);
  out('  (S suspected counts as positive; N negated and H historical do not count by default)');
  if (pack.masking && pack.mode !== 'research') out('Masking: this pack masks repository-template lines and lines shared by many items of a run; one sentence on its own is read in full (use explain <run> --item ID to see what a run masked).');
  void words;
  const doc = prepareItem({ ...item, text: { text } }, pack);
  const hits = [];
  for (const rule of pack.rules) {
    const r = evaluate(rule.match, doc, rule.id);
    if (r.ok && r.evidence.length) hits.push(`  ${rule.id} (${rule.tier}): ${r.evidence.map((e) => `"${e.text}" [${e.context}${e.fuzzy ? ', spelling-tolerant' : ''}]`).join(', ')}`);
  }
  out(hits.length ? 'Rules matched:' : 'Rules matched: none');
  for (const h of hits) out(h);
  const seen = new Set();
  const sup = doc.suppressed.filter((s) => {
    const k = `${s.rule}|${s.field}|${s.start}|${s.end}`;
    return seen.has(k) ? false : seen.add(k);
  });
  if (sup.length) {
    out('Mentions that did not count:');
    for (const s of sup) out(`  ${s.rule}: "${s.text}" [${s.context}]`);
  }
  return 0;
}

async function cmdValidate({ positional }) {
  need(positional, 1, 'urgent-first validate <pack>');
  const pack = loadPack(positional[0]);
  researchNotice(pack);
  out(`OK: pack ${pack.name} ${pack.version} (${pack.rules.length} rules, tiers ${pack.tiers.map((t) => t.id).join('/')}, mode ${pack.mode})`);
  return 0;
}

async function cmdNewPack({ positional, flags }) {
  need(positional, 1, 'urgent-first new-pack <dir> [--name NAME]');
  const dir = path.resolve(positional[0]);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new UserError(`${dir} exists and is not empty`);
  const name = typeof flags.name === 'string' ? flags.name : path.basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const tplDir = path.join(PACKS_DIR, '..', 'references', 'templates');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['pack.json', 'README.md', 'review.md', 'labelled.jsonl']) {
    const src = readText(path.join(tplDir, `pack-template.${f}`)).replace(/__PACK_NAME__/g, name);
    writeInside(dir, f, src);
  }
  out(`Created ${dir} (pack.json, README.md, review.md, labelled.jsonl).`);
  out(`Next: edit pack.json, then urgent-first validate "${dir}" and urgent-first eval "${dir}" "${path.join(dir, 'labelled.jsonl')}"`);
  return 0;
}

async function cmdPacks() {
  for (const name of listPacks()) {
    try {
      const p = loadPack(name);
      out(`${name.padEnd(22)} ${p.version.padEnd(8)} ${p.mode === 'research' ? '[research] ' : ''}${p.title}`);
    } catch (err) {
      out(`${name.padEnd(22)} INVALID: ${err.message}`);
    }
  }
  return 0;
}

const COMMANDS = {
  run: cmdRun,
  github: cmdGithub,
  watch: cmdWatch,
  seen: cmdSeen,
  'annotate-template': cmdAnnotateTemplate,
  merge: cmdMerge,
  eval: cmdEval,
  shadow: cmdShadow,
  'shadow-report': cmdShadowReport,
  'bench-fetch': cmdBenchFetch,
  explain: cmdExplain,
  validate: cmdValidate,
  'new-pack': cmdNewPack,
  packs: cmdPacks,
  snapshot: cmdSnapshot,
  links: cmdLinks,
  diff: cmdDiff,
  digest: cmdDigest,
  review: cmdReview,
  calibrate: cmdCalibrate,
  pack: cmdPack,
};

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    out(HELP);
    return cmd ? 0 : 1;
  }
  if (cmd === '--version' || cmd === '-v') {
    out(VERSION);
    return 0;
  }
  const fn = COMMANDS[cmd];
  if (!fn) {
    process.stderr.write(`Unknown command "${cmd}".\n\n${HELP}\n`);
    return 1;
  }
  try {
    return await fn(parseArgs(rest));
  } catch (err) {
    if (err instanceof UserError) {
      process.stderr.write(`urgent-first: ${err.message}\n`);
      for (const d of err.details.slice(0, 40)) process.stderr.write(`  - ${d}\n`);
      if (err.details.length > 40) process.stderr.write(`  ... ${err.details.length - 40} more\n`);
      return err.exitCode;
    }
    throw err;
  }
}

export { formatMinutes };
