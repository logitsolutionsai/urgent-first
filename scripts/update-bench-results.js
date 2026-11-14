#!/usr/bin/env node
// Regenerate the published benchmark numbers.
// Runs `eval` (rules only, and rules + annotations where an annotations file exists) on the dev and test
// split of every benchmark, writes bench/results.json, and rewrites the tables between the markers
//   <!-- bench:<pack>:start --> ... <!-- bench:<pack>:end -->
// in README.md, packs/<pack>/README.md and bench/<pack>/README.md.
// tests/bench.test.js re-runs eval and fails if the code no longer reproduces these numbers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../src/pack.js';
import { loadItems } from '../src/adapters/index.js';
import { evaluateLabelled } from '../src/eval.js';
import { readJsonl } from '../src/util.js';
import { pct } from '../src/stats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BENCHES = ['radiology-research', 'github-maintainer', 'oncall'];

function summary(m) {
  return {
    items: m.items,
    gold_t1: m.critical_sensitivity.total,
    t1_caught: m.critical_sensitivity.caught,
    t1_sensitivity: m.critical_sensitivity.value,
    t1_wilson95: m.critical_sensitivity.wilson95,
    missed_t1: m.missed_critical.map((x) => x.id),
    over_triage: m.over_triage_rate.value,
    false_flags: m.false_flag_rate.value,
    exact_agreement: m.exact_tier_agreement.value,
    kendall_tau_b: m.kendall_tau_b,
  };
}

export function computeResults() {
  const out = {};
  for (const name of BENCHES) {
    const pack = loadPack(name);
    out[name] = {};
    for (const split of ['dev', 'test']) {
      const file = path.join(ROOT, 'bench', name, `${split}.jsonl`);
      if (!fs.existsSync(file)) continue;
      const { items } = loadItems(file);
      const annFile = path.join(ROOT, 'bench', name, `annotations.${split}.jsonl`);
      const annotations = fs.existsSync(annFile) ? readJsonl(annFile) : null;
      const rep = evaluateLabelled(items, pack, { annotations, inputLabel: `${split}.jsonl` });
      out[name][split] = { rules_only: summary(rep.rules_only) };
      if (rep.with_annotations) {
        out[name][split].with_annotations = summary(rep.with_annotations);
        out[name][split].annotations = { accepted: rep.annotation_validation.accepted, rejected: rep.annotation_validation.rejected, applied: rep.annotation_validation.applied };
      }
    }
  }
  return out;
}

function ci(s) {
  return `${pct(s.t1_wilson95[0])} to ${pct(s.t1_wilson95[1])}`;
}

export function tableFor(name, res) {
  const L = [];
  L.push('| Split | Mode | Items | Gold T1 | T1 caught | T1 sensitivity | Wilson 95% CI | Missed T1 | Over-triage | False flags | Kendall tau-b |');
  L.push('| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |');
  for (const split of ['dev', 'test']) {
    const r = res[name][split];
    if (!r) continue;
    const rows = [['rules only', r.rules_only]];
    if (r.with_annotations) rows.push(['rules + annotations', r.with_annotations]);
    for (const [mode, s] of rows) {
      L.push(`| ${split} | ${mode} | ${s.items} | ${s.gold_t1} | ${s.t1_caught} | ${pct(s.t1_sensitivity)} | ${ci(s)} | ${s.missed_t1.length} | ${pct(s.over_triage)} | ${pct(s.false_flags)} | ${s.kendall_tau_b === null ? 'n/a' : s.kendall_tau_b.toFixed(3)} |`);
    }
  }
  L.push('');
  L.push('Reproduce:');
  L.push('');
  L.push('```bash');
  for (const split of ['dev', 'test']) {
    if (!res[name][split]) continue;
    const ann = fs.existsSync(path.join(ROOT, 'bench', name, `annotations.${split}.jsonl`)) ? ` --annotations bench/${name}/annotations.${split}.jsonl` : '';
    L.push(`node scripts/urgent-first.mjs eval ${name} bench/${name}/${split}.jsonl${ann}`);
  }
  L.push('```');
  return L.join('\n');
}

export function replaceBlock(text, name, table) {
  const start = `<!-- bench:${name}:start -->`;
  const end = `<!-- bench:${name}:end -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i < 0 || j < 0) return null;
  return `${text.slice(0, i + start.length)}\n${table}\n${text.slice(j)}`;
}

export function targetsFor(name) {
  return [path.join(ROOT, 'README.md'), path.join(ROOT, 'packs', name, 'README.md'), path.join(ROOT, 'bench', name, 'README.md')];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = computeResults();
  fs.writeFileSync(path.join(ROOT, 'bench', 'results.json'), JSON.stringify(res, null, 2) + '\n');
  for (const name of BENCHES) {
    const table = tableFor(name, res);
    for (const f of targetsFor(name)) {
      if (!fs.existsSync(f)) continue;
      const updated = replaceBlock(fs.readFileSync(f, 'utf8'), name, table);
      if (updated !== null) {
        fs.writeFileSync(f, updated);
        console.log(`updated ${path.relative(ROOT, f)} (${name})`);
      }
    }
    for (const split of ['dev', 'test']) {
      const r = res[name][split];
      if (!r) continue;
      const s = r.rules_only;
      console.log(`${name} ${split}: T1 ${s.t1_caught}/${s.gold_t1} (${pct(s.t1_sensitivity)}), missed ${s.missed_t1.join(', ') || 'none'}`);
      if (r.with_annotations) console.log(`  + annotations: T1 ${r.with_annotations.t1_caught}/${r.with_annotations.gold_t1}, missed ${r.with_annotations.missed_t1.join(', ') || 'none'}`);
    }
  }
}
