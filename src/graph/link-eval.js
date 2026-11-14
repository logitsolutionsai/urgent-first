// Candidate-link precision and recall on a labelled pair set (bench/maintainer-radar/).
// Items go through the same path as `snapshot run`: the github-maintainer pack's engine (masking, negation)
// and buildSnapshot, then candidateLinks. A predicted link is any possible_duplicate or same_symptom edge.
//   precision = predicted links that join a labelled same_problem pair / all predicted links
//   recall    = labelled same_problem pairs that got a link / all labelled same_problem pairs
// A predicted link between two items with no label counts against precision (every item in the set is
// labelled with every pair that matters, so an unlabelled link is a false link).
// Wilson 95% intervals; the scores are ranking signals and these are counts, not calibrated probabilities.
import { loadPack } from '../pack.js';
import { loadItems } from '../adapters/index.js';
import { readJsonl } from '../util.js';
import { stripGold } from '../items.js';
import { triage } from '../engine.js';
import { buildSnapshot } from '../snapshot/snapshot.js';
import { candidateLinks, THRESHOLDS } from './candidates.js';
import { wilson, round } from '../stats.js';

export function snapshotFromFile(file, packName = 'github-maintainer') {
  const pack = loadPack(packName);
  const items = loadItems(file).items.map(stripGold);
  const result = triage(items, pack, { now: null, inputLabel: file });
  return buildSnapshot({ pack, items, result, source: { kind: 'file', input: file, scope: { kind: 'file' }, complete: true } });
}

const ci = (w) => [round(w.lower, 4), round(w.upper, 4)];
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function evaluateLinks(itemsFile, labelsFile, { thresholds = THRESHOLDS } = {}) {
  const snap = snapshotFromFile(itemsFile);
  const local = new Map(snap.items.map((i) => [i.id, i.localId]));
  const labels = readJsonl(labelsFile);
  const byPair = new Map(labels.map((l) => [key(l.a, l.b), l]));
  const res = candidateLinks(snap, { thresholds });
  const predicted = res.edges.map((e) => ({ a: local.get(e.from), b: local.get(e.to), type: e.type, score: e.score }));
  const positives = labels.filter((l) => l.label === 'same_problem');
  const tp = predicted.filter((p) => byPair.get(key(p.a, p.b))?.label === 'same_problem');
  const fp = predicted.filter((p) => byPair.get(key(p.a, p.b))?.label !== 'same_problem');
  const found = new Set(tp.map((p) => key(p.a, p.b)));
  const missed = positives.filter((l) => !found.has(key(l.a, l.b)));
  const byCategory = {};
  for (const l of labels) {
    const c = (byCategory[l.category] ||= { pairs: 0, linked: 0 });
    c.pairs++;
    if (predicted.some((p) => key(p.a, p.b) === key(l.a, l.b))) c.linked++;
  }
  const byType = {};
  for (const p of predicted) {
    const t = (byType[p.type] ||= { predicted: 0, correct: 0 });
    t.predicted++;
    if (byPair.get(key(p.a, p.b))?.label === 'same_problem') t.correct++;
  }
  const P = predicted.length;
  return {
    items: snap.items.length,
    labelled_pairs: labels.length,
    positive_pairs: positives.length,
    thresholds: { ...thresholds },
    predicted_links: P,
    true_links: tp.length,
    precision: P ? round(tp.length / P, 4) : null,
    precision_wilson95: P ? ci(wilson(tp.length, P)) : null,
    recall: positives.length ? round(tp.length / positives.length, 4) : null,
    recall_wilson95: positives.length ? ci(wilson(tp.length, positives.length)) : null,
    by_type: byType,
    by_category: byCategory,
    suppressed_conflicts: res.suppressed.map((s) => ({ a: local.get(s.from), b: local.get(s.to), score: s.score, rules: s.conflicts.map((c) => c.ruleId) })),
    false_links: fp.map((p) => ({ ...p, category: byPair.get(key(p.a, p.b))?.category || 'unlabelled' })),
    missed_pairs: missed.map((l) => ({ a: l.a, b: l.b, note: l.note })),
  };
}
