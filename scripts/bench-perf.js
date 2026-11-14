#!/usr/bin/env node
// Measures snapshot and evidence-graph time on synthetic issue queues (default 2,000 and 10,000 items).
// The text is generated from a seeded vocabulary with a share of near-duplicate bursts, so the candidate
// engine has real work. Prints one line per size; docs/MAINTAINER-RADAR.md records a run with its machine.
// Run: node scripts/bench-perf.js [2000 10000]
import os from 'node:os';
import { loadPack } from '../src/pack.js';
import { normalizeItems } from '../src/items.js';
import { triage } from '../src/engine.js';
import { buildSnapshot } from '../src/snapshot/snapshot.js';
import { buildGraph } from '../src/graph/build.js';
import { seededRandom } from '../src/util.js';

const WORDS = 'sync export login theme search plugin installer editor sidebar canvas proxy webhook calendar backup printer font toolbar vault folder note tag link image table chart cursor shortcut window dialog menu tab pane preview history archive mobile tablet desktop server client cache index query filter sort import upload download share comment mention reminder'.split(' ');
const VERBS = 'fails crashes hangs freezes breaks stalls disappears flickers resets duplicates truncates ignores'.split(' ');
const ERRORS = ['EACCES', 'ENOENT', 'ECONNRESET', 'ETIMEDOUT', 'TypeError', 'RangeError', 'HTTP 500', 'HTTP 409', 'SIGSEGV', 'ERR_INVALID_ARG_TYPE'];

export function syntheticQueue(n, seed = 11) {
  const rand = seededRandom(seed);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const burst = i % 25 === 0 ? null : rows.length && rand() < 0.15 ? rows[Math.floor(rand() * rows.length)] : null;
    if (burst) {
      rows.push({ id: `perf-${i}`, title: `${burst.title} (also on ${pick(WORDS)})`, text: { body: `${burst.text.body} Same here with ${pick(WORDS)}.` }, created_at: new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString() });
      continue;
    }
    // Two rare words per original report (component names, flags), as real reports have: a long-tail vocabulary.
    const SYL = ['ka', 'zu', 'mor', 'tel', 'vin', 'qua', 'rix', 'lo', 'pen', 'dra', 'sho', 'gim'];
    const rare = () => Array.from({ length: 3 }, () => pick(SYL)).join('') + Math.floor(rand() * 9);
    const a = pick(WORDS);
    const b = pick(WORDS);
    const body = [];
    for (let k = 0; k < 4 + Math.floor(rand() * 6); k++) body.push(`The ${pick(WORDS)} ${pick(VERBS)} when I open the ${pick(WORDS)} ${pick(WORDS)}.`);
    if (rand() < 0.4) body.push(`Error: ${pick(ERRORS)} in ${pick(WORDS)}.`);
    body.push(`Seen in the ${rare()} module with the ${rare()} flag.`);
    rows.push({ id: `perf-${i}`, title: `${a[0].toUpperCase()}${a.slice(1)} ${pick(VERBS)} with ${b} ${i % 97}`, text: { body: body.join(' ') }, created_at: new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString() });
  }
  return rows;
}

export function measure(n) {
  const pack = loadPack('github-maintainer');
  const items = normalizeItems(syntheticQueue(n));
  const t0 = performance.now();
  const result = triage(items, pack, {});
  const t1 = performance.now();
  const snap = buildSnapshot({ pack, items, result, source: { kind: 'file', input: `synthetic-${n}`, scope: { kind: 'file' }, complete: true } });
  const t2 = performance.now();
  const graph = buildGraph(snap);
  const t3 = performance.now();
  const cand = graph.edges.filter((e) => e.certainty === 'candidate').length;
  return { items: n, engineMs: Math.round(t1 - t0), snapshotMs: Math.round(t2 - t1), graphMs: Math.round(t3 - t2), totalMs: Math.round(t3 - t0), comparisons: graph.stats.comparisons, candidateLinks: cand, droppedByCap: graph.stats.droppedByCap };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}` || process.argv[1].endsWith('bench-perf.js')) {
  const sizes = process.argv.slice(2).map(Number).filter(Boolean);
  process.stdout.write(`node ${process.version} · ${os.cpus()[0]?.model || 'unknown CPU'} · ${os.cpus().length} logical CPUs · ${Math.round(os.totalmem() / 2 ** 30)} GB · ${process.platform}\n`);
  for (const n of sizes.length ? sizes : [2000, 10000]) {
    const r = measure(n);
    process.stdout.write(`${String(r.items).padStart(6)} items: engine ${r.engineMs} ms, snapshot ${r.snapshotMs} ms, graph ${r.graphMs} ms, total ${r.totalMs} ms; ${r.comparisons} pair comparisons (${(r.comparisons / r.items).toFixed(1)} per item), ${r.candidateLinks} candidate links, ${r.droppedByCap} dropped by the per-item cap\n`);
  }
}
