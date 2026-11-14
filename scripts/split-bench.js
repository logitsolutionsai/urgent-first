#!/usr/bin/env node
// Split a benchmark's raw cases into dev and test with a seeded, stratified shuffle.
// Usage: node scripts/split-bench.js bench/<name> [--test-fraction 0.6] [--seed 20261114]
// Strata: (source file, gold tier). The split is reproducible: the same raw files and seed give the
// same dev.jsonl and test.jsonl. Rule authors read dev only; test is for reporting.
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, toJsonl, seededRandom } from '../src/util.js';

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) {
  console.error('Usage: node scripts/split-bench.js bench/<name> [--test-fraction 0.6] [--seed 20261114]');
  process.exit(1);
}
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const testFraction = Number(flag('test-fraction', '0.6'));
const seed = Number(flag('seed', '20261114'));

const rawDir = path.join(dir, 'raw');
const files = fs.readdirSync(rawDir).filter((f) => f.endsWith('.jsonl')).sort();
const strata = new Map();
const all = [];
for (const f of files) {
  for (const row of readJsonl(path.join(rawDir, f))) {
    const key = `${f}|${row.gold?.tier}`;
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(row.id);
    all.push(row);
  }
}
const rand = seededRandom(seed);
const testIds = new Set();
for (const key of [...strata.keys()].sort()) {
  const ids = [...strata.get(key)].sort();
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const nTest = Math.round(ids.length * testFraction);
  ids.slice(0, nTest).forEach((id) => testIds.add(id));
}
const dev = all.filter((r) => !testIds.has(r.id));
const test = all.filter((r) => testIds.has(r.id));
fs.writeFileSync(path.join(dir, 'dev.jsonl'), toJsonl(dev));
fs.writeFileSync(path.join(dir, 'test.jsonl'), toJsonl(test));
const count = (rows) => rows.reduce((acc, r) => ((acc[r.gold.tier] = (acc[r.gold.tier] || 0) + 1), acc), {});
console.log(`dev:  ${dev.length} ${JSON.stringify(count(dev))}`);
console.log(`test: ${test.length} ${JSON.stringify(count(test))}`);
