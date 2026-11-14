#!/usr/bin/env node
// The real-world GitHub benchmark: rules only, before and after template masking and pull request inheritance,
// and the "after" rules followed by one blind Claude review pass (SKILL.md flow 1, steps 3 and 4).
//
//   node scripts/urgent-first.mjs bench-fetch bench/github-real/ids.jsonl     # once: text into the user cache
//   node scripts/bench-real.js [--items FILE] [--write]
//
// "Before" is bench/github-real/before-pack (the github-maintainer rules frozen before those two changes, run
// without templates). "After" is the bundled github-maintainer pack with the repositories' templates.
// "After + Claude review" merges bench/github-real/annotations.<split>.jsonl (REVIEW below) on top of "after".
// Gold is the maintainers' own urgency label (bench/github-real/README.md); every label is stripped from the
// input by bench-fetch. --write updates bench/github-real/results.json and the tables in the READMEs.
// The repository holds no issue text: only references, gold tiers, labels, the per-item predicted tiers and the
// reviewer's annotations (short quoted spans, a one-sentence reason each).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../src/pack.js';
import { loadItems } from '../src/adapters/index.js';
import { evaluateLabelled } from '../src/eval.js';
import { triage } from '../src/engine.js';
import { mergeAnnotations, reviewQueue } from '../src/annotate.js';
import { stripGold } from '../src/items.js';
import { pct } from '../src/stats.js';
import { readJsonl } from '../src/util.js';
import { cacheRoot } from '../src/adapters/github-extra.js';
import { readIds } from '../src/benchfetch.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'bench', 'github-real');
export const DEFAULT_ITEMS = path.join(cacheRoot(), 'github-real', 'items.jsonl');

// The review pass, run once per split by a fresh reviewer that saw only the review queue, the pack's review.md
// and references/annotation-contract.md. Procedure: bench/github-real/README.md, "Rules + Claude Review".
export const REVIEW = {
  date: '2026-11-14',
  model: 'claude-opus-5-5',
  procedure:
    'Per repository, the after rules ran as `urgent-first github` would (repository templates, labels stripped), then `urgent-first annotate-template` wrote the default review queue (every item below T1, plus items with negated, historical or spelling-tolerant mentions). One fresh Claude subagent per split read only the queue files, the pack review.md and the annotation contract, with no gold labels, no ids or results files and no network, and wrote annotations.jsonl. `urgent-first merge` validated them. Nothing was tuned on the results.',
  files: { heldout: 'annotations.heldout.jsonl', dev: 'annotations.dev.jsonl' },
};

function repoOf(id) {
  return id.slice(0, id.indexOf('#'));
}

function reviewFile(split) {
  const f = REVIEW.files[split];
  return f && fs.existsSync(path.join(DIR, f)) ? path.join(DIR, f) : null;
}

function summary(rep, key = 'rules_only') {
  const m = rep[key];
  const f = m.flags;
  return {
    items: m.items,
    urgent: f.recall.total,
    baseline: f.false_flag_rate.total,
    flagged: f.precision.total,
    flagged_t1: m.confusion ? Object.values(m.confusion).reduce((acc, row) => acc + row.T1, 0) : null,
    recall: f.recall.value,
    recall_wilson95: f.recall.wilson95,
    recall_count: f.recall.count,
    precision: f.precision.value,
    precision_wilson95: f.precision.wilson95,
    precision_count: f.precision.count,
    false_flag_rate: f.false_flag_rate.value,
    false_flag_wilson95: f.false_flag_rate.wilson95,
    false_flag_count: f.false_flag_rate.count,
    gold_t1: m.critical_sensitivity.total,
    t1_caught_at_t1: m.critical_sensitivity.caught,
    confusion: m.confusion,
  };
}

/** Compute every number published for bench/github-real from the fetched items. */
export function computeReal(itemsFile = DEFAULT_ITEMS) {
  const ids = readIds(path.join(DIR, 'ids.jsonl'));
  const splits = JSON.parse(fs.readFileSync(path.join(DIR, 'splits.json'), 'utf8'));
  const { items } = loadItems(itemsFile, { format: 'jsonl' });
  const templates = JSON.parse(fs.readFileSync(itemsFile.replace(/\.jsonl$/i, '') + '.templates.json', 'utf8'));
  const byId = new Map(items.map((it) => [it.id, it]));
  const missing = ids.filter((r) => !byId.has(r.ref)).map((r) => r.ref);
  for (const it of items) if (it.labels.length) throw new Error(`${it.id} still has labels: bench-fetch must strip them`);
  const before = loadPack(path.join(DIR, 'before-pack'));
  const after = loadPack('github-maintainer');
  const out = { splits: {}, per_repo: {}, missing, predictions: [] };
  const configs = [
    ['before', before, null],
    ['after', after, templates],
  ];
  const annotations = {};
  const review = { date: REVIEW.date, model: REVIEW.model, procedure: REVIEW.procedure, files: {}, queue_items: {}, validation: {} };
  for (const [split, repos] of Object.entries(splits)) {
    if (split.startsWith('_')) continue;
    const subset = items.filter((it) => repos.includes(repoOf(it.id)));
    out.splits[split] = { repos };
    for (const [name, pack, tpl] of configs) out.splits[split][name] = summary(evaluateLabelled(subset, pack, { templates: tpl, inputLabel: `github-real ${split}` }));
    const file = reviewFile(split);
    if (!file) continue;
    const ann = readJsonl(file);
    for (const a of ann) if (!repos.includes(repoOf(String(a.item_id)))) throw new Error(`${path.basename(file)}: ${a.item_id} is not in split ${split}`);
    for (const repo of repos) annotations[repo] = ann.filter((a) => repoOf(String(a.item_id)) === repo);
    const rep = evaluateLabelled(subset, after, { templates, annotations: ann, inputLabel: `github-real ${split}` });
    out.splits[split].review = summary(rep, 'with_annotations');
    review.files[split] = `bench/github-real/${REVIEW.files[split]}`;
    review.validation[split] = rep.annotation_validation;
  }
  // Per repository, each run on its own as a maintainer would (boilerplate shares are per run). The review pass
  // was merged per repository too, on the same run's queue.
  const pred = new Map();
  for (const repo of [...new Set(items.map((it) => repoOf(it.id)))]) {
    const subset = items.filter((it) => repoOf(it.id) === repo);
    out.per_repo[repo] = {};
    for (const [name, pack, tpl] of configs) {
      out.per_repo[repo][name] = summary(evaluateLabelled(subset, pack, { templates: tpl }));
      const res = triage(subset.map(stripGold), pack, { templates: tpl });
      for (const r of res.items) {
        if (!pred.has(r.id)) pred.set(r.id, {});
        pred.get(r.id)[name] = r.tier;
      }
      if (name !== 'after' || !annotations[repo]) continue;
      review.queue_items[repo] = reviewQueue(res).length;
      out.per_repo[repo].review = summary(evaluateLabelled(subset, pack, { templates: tpl, annotations: annotations[repo] }), 'with_annotations');
      const merged = mergeAnnotations(res, pack, annotations[repo], new Map(subset.map((it) => [it.id, stripGold(it)])));
      for (const r of merged.items) pred.get(r.id).review = r.tier;
    }
  }
  for (const r of ids) {
    if (!pred.has(r.ref)) continue;
    const p = pred.get(r.ref);
    out.predictions.push({ ref: r.ref, gold: r.gold, label: r.label, before: p.before, after: p.after, ...(p.review ? { review: p.review } : {}) });
  }
  if (Object.keys(review.files).length) out.review = review;
  return out;
}

const ci = (w) => (w ? `${pct(w[0])} to ${pct(w[1])}` : 'n/a');

export function realTable(res) {
  const L = [];
  L.push('| Split | Repositories | Rules | Items (urgent / not) | Flagged | Precision (Wilson 95% CI) | Recall of urgent (Wilson 95% CI) | False flags on not urgent | Gold T1 caught at T1 |');
  L.push('| --- | --- | --- | ---: | ---: | --- | --- | --- | ---: |');
  for (const [split, s] of Object.entries(res.splits)) {
    for (const name of ['before', 'after', 'review']) {
      const m = s[name];
      if (!m) continue;
      L.push(`| ${split} | ${s.repos.join(', ')} | ${MODE[name]} | ${m.items} (${m.urgent} / ${m.baseline}) | ${m.flagged} | ${pct(m.precision)} (${ci(m.precision_wilson95)}) | ${m.recall_count}/${m.urgent} = ${pct(m.recall)} (${ci(m.recall_wilson95)}) | ${m.false_flag_count}/${m.baseline} = ${pct(m.false_flag_rate)} (${ci(m.false_flag_wilson95)}) | ${m.t1_caught_at_t1}/${m.gold_t1} |`);
    }
  }
  const reviewed = Object.values(res.per_repo).some((r) => r.review);
  const arrow = (r, f) => [r.before, r.after, ...(reviewed ? [r.review] : [])].map((m) => (m ? f(m) : 'n/a')).join(' → ');
  const head = reviewed ? 'before → after → after + review' : 'before → after';
  L.push('');
  L.push(`| Repository | Items (urgent / not) | ${reviewed ? 'Review queue | ' : ''}Flagged ${head} | Precision ${head} | Recall ${head} |`);
  L.push(`| --- | ---: | ${reviewed ? '---: | ' : ''}---: | --- | --- |`);
  for (const [repo, r] of Object.entries(res.per_repo)) {
    const q = reviewed ? `${res.review && res.review.queue_items[repo] !== undefined ? res.review.queue_items[repo] : 'n/a'} | ` : '';
    L.push(`| ${repo} | ${r.after.items} (${r.after.urgent} / ${r.after.baseline}) | ${q}${arrow(r, (m) => String(m.flagged))} | ${arrow(r, (m) => pct(m.precision))} | ${arrow(r, (m) => pct(m.recall))} |`);
  }
  if (reviewed) {
    L.push('');
    L.push('| Split | Rules | Gold T1 placed T1 / T2 / T3 | Gold T2 placed T1 / T2 / T3 | Gold T3 placed T1 / T2 / T3 |');
    L.push('| --- | --- | --- | --- | --- |');
    for (const [split, s] of Object.entries(res.splits)) {
      for (const name of ['after', 'review']) {
        const c = s[name] && s[name].confusion;
        if (!c) continue;
        const row = (g) => (Object.values(c[g]).some((n) => n) ? ['T1', 'T2', 'T3'].map((p) => c[g][p]).join(' / ') : 'none');
        L.push(`| ${split} | ${MODE[name]} | ${row('T1')} | ${row('T2')} | ${row('T3')} |`);
      }
    }
  }
  return L.join('\n');
}

const MODE = { before: 'before', after: 'after', review: 'after + Claude review' };

export function realTargets() {
  return [path.join(ROOT, 'README.md'), path.join(DIR, 'README.md'), path.join(ROOT, 'packs', 'github-maintainer', 'README.md')];
}

function replaceBlock(text, body) {
  const start = '<!-- bench:github-real:start -->';
  const end = '<!-- bench:github-real:end -->';
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a === -1 || b === -1) return null;
  return text.slice(0, a + start.length) + '\n' + body + '\n' + text.slice(b);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--items');
  const itemsFile = i >= 0 ? args[i + 1] : DEFAULT_ITEMS;
  if (!fs.existsSync(itemsFile)) {
    process.stderr.write(`No fetched items at ${itemsFile}. Run: node scripts/urgent-first.mjs bench-fetch bench/github-real/ids.jsonl\n`);
    process.exit(1);
  }
  const res = computeReal(itemsFile);
  const table = realTable(res);
  process.stdout.write(table + '\n');
  if (res.missing.length) process.stdout.write(`\nMissing (not fetched): ${res.missing.join(', ')}\n`);
  if (args.includes('--write')) {
    fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(res, null, 2) + '\n');
    for (const f of realTargets()) {
      if (!fs.existsSync(f)) continue;
      const next = replaceBlock(fs.readFileSync(f, 'utf8'), table);
      if (next !== null) fs.writeFileSync(f, next);
    }
    process.stdout.write('\nWrote bench/github-real/results.json and the README tables.\n');
  }
}
