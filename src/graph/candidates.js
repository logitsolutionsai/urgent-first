// Candidate links between reports: deterministic, inspectable, conservative by construction.
//
// 1. Features per item (src/graph/features.js): title x3, error identifiers x4, versions x2, body x1, with
//    engine-masked template lines removed. Lines of five or more words that appear in three or more items of
//    the snapshot are also left out of the word features (similarity-only boilerplate; it never changes what
//    the rules read). Each weight is multiplied by idf = ln(1 + N / df); the MAX_FEATURES strongest are kept,
//    so a long report and a short one compare on their most specific words.
// 2. Retrieval: an inverted index over rare features (2 <= df <= max(20, 5% of N), at most half the items and
//    at most MAX_POSTINGS).
//    Each item compares with at most MAX_CANDIDATES others that share the most rare features. No all-pairs
//    pass: the work is bounded by items x kept features x postings.
// 3. Score: weighted Jaccard over the kept features, sum(min) / sum(max), summed in feature order and rounded
//    to 4 decimals. A ranking signal, never a probability.
//    possible_duplicate: score >= THRESHOLDS.possible_duplicate and at least two shared distinctive features
//    (rare, non-stopword); same_symptom: score >= THRESHOLDS.same_symptom and at least one shared distinctive
//    error identifier.
// 4. Contradiction guard: a rule that quotes affirmed text in one item and was read as negated in the other
//    ("data loss" against "no data loss"), or a shared distinctive word that one item only affirms and the
//    other only negates (the engine's negation cues), suppresses the link; it is listed for reviewers as
//    conflicting_evidence, with the quotes.
// 5. Caps: at most MAX_LINKS candidate links per item (highest scores kept, ties by identity), MAX_ITEMS items
//    per run (status "limit" beyond that).
// Everything is keyed by item identity, never by input position, so the same collection in any order gives
// the same links. Links never change a tier; the graph has no priority field at all.
import { itemFeatures, ALGORITHM, STOPWORDS_V1, foldWord, proseOnly } from './features.js';
import { lineKey } from '../mask.js';
import { tokenize } from '../match/text.js';
import { compileCues, computeContext } from '../match/context.js';

const CUES = compileCues({});

/**
 * How each word is used in an item, read with the engine's own negation cues (src/match/context.js, default
 * cue lists): word -> { aff, neg } counts over title and prose. Used only by the contradiction guard.
 */
function wordStances(si) {
  const out = new Map();
  for (const raw of [si.title || '', ...Object.values(si.text || {})]) {
    if (typeof raw !== 'string' || !raw) continue;
    const tokens = tokenize(proseOnly(raw.normalize('NFKC')));
    const ctx = computeContext(tokens, CUES);
    tokens.forEach((t, i) => {
      if (t.k !== 'w') return;
      const w = foldWord(t.t);
      const cur = out.get(w) || { aff: 0, neg: 0 };
      if (ctx.neg[i] && !ctx.susp[i]) cur.neg++;
      else cur.aff++;
      out.set(w, cur);
    });
  }
  return out;
}

// Thresholds. The release brief proposed 0.72 and 0.50 without data. They were changed on the development pair
// set only (bench/maintainer-radar/candidates.dev.*): for each type, the lowest value on a 0.05 grid at which
// no labelled hard negative, negation conflict or template-noise pair is linked. Highest dev negative scores:
// 0.4127 for possible_duplicate (feature request against bug report on the same dialog), 0.2103 for a shared
// error code with unrelated causes. The held-out set was never used to choose them; bench/maintainer-radar/
// README.md reports both settings on both sets. Scores rank candidates; they are not probabilities.
export const BRIEF_THRESHOLDS = Object.freeze({ possible_duplicate: 0.72, same_symptom: 0.5 });
export const THRESHOLDS = Object.freeze({ possible_duplicate: 0.45, same_symptom: 0.25 });
export const LIMITS = Object.freeze({ MAX_FEATURES: 40, MAX_POSTINGS: 200, MAX_CANDIDATES: 50, MAX_LINKS: 5, MAX_ITEMS: 30000, BOILERPLATE_ITEMS: 3, BOILERPLATE_WORDS: 5 });

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Lines repeated across items, blanked for similarity only. Returns a copy of each item's masked list plus extra ranges. */
function similarityMasks(items) {
  const counts = new Map();
  const perItem = items.map((si) => {
    const lines = [];
    for (const [field, text] of Object.entries(si.text || {})) {
      if (typeof text !== 'string') continue;
      let start = 0;
      while (start <= text.length) {
        let end = text.indexOf('\n', start);
        if (end === -1) end = text.length;
        const key = lineKey(text.slice(start, end));
        if (key.split(' ').length >= LIMITS.BOILERPLATE_WORDS) lines.push({ field, start, end, key });
        start = end + 1;
      }
    }
    const seen = new Set();
    for (const l of lines) {
      if (seen.has(l.key)) continue;
      seen.add(l.key);
      counts.set(l.key, (counts.get(l.key) || 0) + 1);
    }
    return lines;
  });
  return items.map((si, i) => {
    const extra = perItem[i].filter((l) => counts.get(l.key) >= LIMITS.BOILERPLATE_ITEMS).map((l) => ({ field: l.field, start: l.start, end: l.end, kind: 'similarity-boilerplate' }));
    return extra.length ? { ...si, masked: [...(si.masked || []), ...extra] } : si;
  });
}

/** Rules a snapshot item quotes as affirmed, and rules it mentions only negated. */
function ruleStances(si) {
  const affirmed = new Set(si.ruleIds.filter((r) => !r.startsWith('floor:')));
  const negated = new Map();
  for (const s of si.suppressed || []) if (s.context === 'negated' && !affirmed.has(s.ruleId) && !negated.has(s.ruleId)) negated.set(s.ruleId, s);
  return { affirmed, negated };
}

function conflictBetween(a, b, evidenceByItem, shared = [], stanceOf = null) {
  const sa = ruleStances(a);
  const sb = ruleStances(b);
  const found = [];
  for (const [x, y, sx, sy] of [[a, b, sa, sb], [b, a, sb, sa]]) {
    for (const rule of [...sx.affirmed].sort()) {
      const neg = sy.negated.get(rule);
      if (!neg) continue;
      const ev = (evidenceByItem.get(x.id) || []).find((e) => e.ruleId === rule);
      found.push({ ruleId: rule, affirmed: { itemId: x.id, field: ev?.field ?? null, start: ev?.start ?? null, end: ev?.end ?? null, text: ev?.text ?? null }, negated: { itemId: y.id, field: neg.field, start: neg.start, end: neg.end, text: neg.text } });
    }
  }
  // Word level: a shared distinctive word that one report only affirms and the other only negates
  // ("I lost all my notes" against "nothing was lost").
  if (stanceOf) {
    const wa = stanceOf(a);
    const wb = stanceOf(b);
    for (const f of shared) {
      if (!f.startsWith('w:')) continue;
      const w = f.slice(2);
      const x = wa.get(w);
      const y = wb.get(w);
      if (!x || !y) continue;
      if (x.aff && !x.neg && y.neg && !y.aff) found.push({ ruleId: null, word: w, affirmed: { itemId: a.id }, negated: { itemId: b.id } });
      else if (y.aff && !y.neg && x.neg && !x.aff) found.push({ ruleId: null, word: w, affirmed: { itemId: b.id }, negated: { itemId: a.id } });
    }
  }
  return found;
}

/**
 * @param {object} snapshot a verified snapshot
 * @param {{thresholds?: object, includeNear?: boolean}} opts
 * @returns {{edges: object[], suppressed: object[], near: object[], stats: object}}
 */
export function candidateLinks(snapshot, { thresholds = THRESHOLDS, includeNear = false } = {}) {
  let items = snapshot.items;
  let limited = false;
  if (items.length > LIMITS.MAX_ITEMS) {
    items = items.slice(0, LIMITS.MAX_ITEMS);
    limited = true;
  }
  // Identity order: the order of the input never matters below this line.
  items = [...items].sort((a, b) => cmp(a.id, b.id));
  const prepared = similarityMasks(items);
  const N = items.length;
  const feats = prepared.map(itemFeatures);
  const df = new Map();
  for (const f of feats) for (const k of f.base.keys()) df.set(k, (df.get(k) || 0) + 1);
  // Rare enough to retrieve on: at most max(20, 5% of N) items and never half the collection. A burst of
  // ten identical reports after a release stays retrievable; words most reports share do not.
  const rareMax = Math.min(LIMITS.MAX_POSTINGS, Math.max(20, Math.ceil(0.05 * N)), Math.max(2, Math.floor(N / 2)));
  const idf = (k) => Math.log(1 + N / df.get(k));
  const kept = feats.map((f) => {
    const arr = [...f.base].map(([k, b]) => [k, b * idf(k)]);
    arr.sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]));
    return arr.slice(0, LIMITS.MAX_FEATURES).sort((x, y) => cmp(x[0], y[0]));
  });
  const distinctive = (k) => {
    const d = df.get(k);
    if (d > rareMax) return false;
    return !(k.startsWith('w:') && STOPWORDS_V1.has(k.slice(2)));
  };
  // Inverted index on rare features.
  const index = new Map();
  kept.forEach((arr, i) => {
    for (const [k] of arr) {
      const d = df.get(k);
      if (d < 2 || d > rareMax || d > LIMITS.MAX_POSTINGS) continue;
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(i);
    }
  });
  const pairs = new Set();
  let comparisons = 0;
  for (let i = 0; i < N; i++) {
    const shared = new Map();
    for (const [k, w] of kept[i]) {
      const post = index.get(k);
      if (!post) continue;
      for (const j of post) {
        if (j === i) continue;
        const cur = shared.get(j) || { n: 0, w: 0 };
        cur.n++;
        cur.w += w;
        shared.set(j, cur);
      }
    }
    const top = [...shared].sort((x, y) => y[1].n - x[1].n || y[1].w - x[1].w || x[0] - y[0]).slice(0, LIMITS.MAX_CANDIDATES);
    for (const [j] of top) pairs.add(i < j ? `${i},${j}` : `${j},${i}`);
  }
  const evidenceByItem = new Map();
  for (const e of snapshot.evidence || []) {
    if (!evidenceByItem.has(e.itemId)) evidenceByItem.set(e.itemId, []);
    evidenceByItem.get(e.itemId).push(e);
  }
  const stanceCache = new Map();
  const stanceOf = (si) => {
    if (!stanceCache.has(si.id)) stanceCache.set(si.id, wordStances(si));
    return stanceCache.get(si.id);
  };
  const accepted = [];
  const suppressed = [];
  const near = [];
  const sortedPairs = [...pairs].map((p) => p.split(',').map(Number)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  for (const [i, j] of sortedPairs) {
    comparisons++;
    const a = kept[i];
    const b = kept[j];
    let num = 0;
    let den = 0;
    let p = 0;
    let q = 0;
    const sharedFeatures = [];
    while (p < a.length || q < b.length) {
      if (q >= b.length || (p < a.length && a[p][0] < b[q][0])) {
        den += a[p][1];
        p++;
      } else if (p >= a.length || b[q][0] < a[p][0]) {
        den += b[q][1];
        q++;
      } else {
        num += Math.min(a[p][1], b[q][1]);
        den += Math.max(a[p][1], b[q][1]);
        sharedFeatures.push(a[p][0]);
        p++;
        q++;
      }
    }
    const score = den > 0 ? Math.round((num / den) * 10000) / 10000 : 0;
    if (score < thresholds.same_symptom) continue;
    const dist = sharedFeatures.filter(distinctive);
    const errA = new Set(feats[i].errors);
    const sharedErrors = feats[j].errors.filter((e) => errA.has(e) && distinctive(`e:${e}`));
    let type = null;
    if (score >= thresholds.possible_duplicate && dist.length >= 2) type = 'possible_duplicate';
    else if (sharedErrors.length) type = 'same_symptom';
    const A = items[i];
    const B = items[j];
    // Display words: the alphabetically first spelling either report used (feature keys are folded).
    const shown = dist.slice(0, 12).map((k) => (k.startsWith('w:') ? [feats[i].surface.get(k), feats[j].surface.get(k)].filter(Boolean).sort()[0] || k.slice(2) : k.slice(2)));
    const reasons = [{ kind: 'shared_features', features: dist.slice(0, 12), words: shown }];
    if (sharedErrors.length) reasons.push({ kind: 'shared_error_signature', errors: sharedErrors });
    if (!type) {
      if (includeNear) near.push({ from: A.id, to: B.id, score, reasons });
      continue;
    }
    const conflict = conflictBetween(A, B, evidenceByItem, dist, stanceOf);
    if (conflict.length) {
      suppressed.push({ from: A.id, to: B.id, type, score, reason: 'conflicting_evidence', conflicts: conflict, reasons });
      continue;
    }
    accepted.push({ from: A.id, to: B.id, type, score, reasons });
  }
  // Cap: highest scores first, ties by identity; an edge is kept while both ends have fewer than MAX_LINKS.
  accepted.sort((x, y) => y.score - x.score || cmp(x.from, y.from) || cmp(x.to, y.to));
  const degree = new Map();
  const edges = [];
  let droppedByCap = 0;
  for (const e of accepted) {
    const da = degree.get(e.from) || 0;
    const db = degree.get(e.to) || 0;
    if (da >= LIMITS.MAX_LINKS || db >= LIMITS.MAX_LINKS) {
      droppedByCap++;
      continue;
    }
    degree.set(e.from, da + 1);
    degree.set(e.to, db + 1);
    edges.push(e);
  }
  return {
    edges,
    suppressed,
    near,
    stats: {
      algorithm: ALGORITHM,
      items: N,
      comparisons,
      rareDfMax: rareMax,
      thresholds: { ...thresholds },
      limits: { ...LIMITS },
      droppedByCap,
      truncatedItems: prepared.filter((_, i) => feats[i].truncated).map((x) => x.id),
      status: limited ? 'limit' : 'complete',
    },
  };
}
