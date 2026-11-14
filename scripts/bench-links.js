#!/usr/bin/env node
// Candidate-link benchmark: precision and recall of `links` on the labelled pair sets in bench/maintainer-radar/,
// at the thresholds the release brief proposed and at the shipped thresholds (chosen on dev only).
// Writes bench/maintainer-radar/results.json; tests/graph.test.js fails if the code no longer reproduces it.
// Run: node scripts/bench-links.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateLinks } from '../src/graph/link-eval.js';
import { THRESHOLDS, BRIEF_THRESHOLDS } from '../src/graph/candidates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'bench', 'maintainer-radar');

export function computeLinkResults() {
  const out = {};
  for (const split of ['dev', 'heldout']) {
    out[split] = {};
    for (const [name, thresholds] of [['brief', BRIEF_THRESHOLDS], ['shipped', THRESHOLDS]]) {
      const r = evaluateLinks(path.join(DIR, `candidates.${split}.jsonl`), path.join(DIR, `candidates.${split}.labels.jsonl`), { thresholds });
      out[split][name] = r;
    }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = computeLinkResults();
  fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(res, null, 2) + '\n');
  for (const [split, v] of Object.entries(res)) for (const [name, r] of Object.entries(v)) process.stdout.write(`${split.padEnd(8)} ${name.padEnd(8)} thresholds ${r.thresholds.possible_duplicate}/${r.thresholds.same_symptom}  precision ${r.true_links}/${r.predicted_links}  recall ${r.true_links}/${r.positive_pairs}  false links ${r.false_links.length}  conflicts suppressed ${r.suppressed_conflicts.length}\n`);
}
