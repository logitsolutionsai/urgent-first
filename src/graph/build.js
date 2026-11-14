// The evidence graph of one snapshot (evidence-graph.json). Navigation and provenance only: no node or edge
// carries a tier or a priority, and building it never changes the snapshot.
//
// Nodes: every item (issue, pull request or imported item), every evidence span, and the latest release when
// the GitHub API supplied one.
// Edges (each with kind, algorithm id, certainty and its support):
//   contains_evidence       item -> evidence span                      direct   engine-evidence-v1
//   fixes                   pull request -> issue, GitHub closing keyword  direct   github-references-v1
//   references              item -> item, any other explicit reference  direct   github-references-v1
//   reported_after_release  item -> release, createdAt >= publishedAt  direct   release-timestamp-v1
//                           (an observed order of timestamps; never a cause)
//   possible_duplicate      item <-> item                              candidate text-signals-v1
//   same_symptom            item <-> item                              candidate text-signals-v1
// Edge ids are digests of (type, from, to, algorithm), so they are stable across runs and input orders.
// Clusters are stars: an anchor and the items with a candidate link to that anchor. Membership says nothing
// about two members' similarity to each other (A ~ B and B ~ C never asserts A ~ C).
import { VERSION } from '../util.js';
import { shortId } from '../snapshot/canonical.js';
import { parseReferences } from './github-links.js';
import { candidateLinks, THRESHOLDS } from './candidates.js';
import { ALGORITHM } from './features.js';

export const GRAPH_SCHEMA_VERSION = 1;
export const ALGORITHMS = Object.freeze({ evidence: 'engine-evidence-v1', references: 'github-references-v1', release: 'release-timestamp-v1', candidates: ALGORITHM });
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function edgeId(type, from, to, algorithm) {
  return shortId('edge', [type, from, to, algorithm]);
}

function repositoryOf(snapshot) {
  return snapshot.source && snapshot.source.kind === 'github' ? snapshot.source.repository : null;
}

/** Star clusters over candidate edges, deterministic: anchors by degree, then total score, then identity. */
export function starClusters(edges) {
  const adj = new Map();
  for (const e of edges) {
    if (e.certainty !== 'candidate') continue;
    for (const [x, y] of [[e.from, e.to], [e.to, e.from]]) {
      if (!adj.has(x)) adj.set(x, []);
      adj.get(x).push({ id: y, score: e.score, edge: e.id, type: e.type });
    }
  }
  const order = [...adj.keys()].sort((a, b) => adj.get(b).length - adj.get(a).length || adj.get(b).reduce((s, x) => s + x.score, 0) - adj.get(a).reduce((s, x) => s + x.score, 0) || cmp(a, b));
  const used = new Set();
  const clusters = [];
  for (const anchor of order) {
    if (used.has(anchor)) continue;
    const members = adj.get(anchor).filter((m) => !used.has(m.id)).sort((a, b) => b.score - a.score || cmp(a.id, b.id));
    if (!members.length) continue;
    used.add(anchor);
    for (const m of members) used.add(m.id);
    clusters.push({ id: shortId('cluster', [anchor, ...members.map((m) => m.id)]), anchor, members: members.map((m) => ({ id: m.id, edge: m.edge, type: m.type, score: m.score })) });
  }
  return clusters;
}

export function buildGraph(snapshot, { includeNear = false, thresholds = THRESHOLDS } = {}) {
  const nodes = [];
  const edges = [];
  const warnings = [];
  const repo = repositoryOf(snapshot);
  const byNumber = new Map();
  for (const si of snapshot.items) {
    nodes.push({ id: si.id, type: si.kind, localId: si.localId, ...(si.number !== null ? { number: si.number } : {}) });
    if (si.number !== null && repo) byNumber.set(si.number, si);
  }
  for (const ev of snapshot.evidence) {
    nodes.push({ id: ev.id, type: 'evidence', itemId: ev.itemId, ruleId: ev.ruleId, kind: ev.kind });
    edges.push({ id: edgeId('contains_evidence', ev.itemId, ev.id, ALGORITHMS.evidence), from: ev.itemId, to: ev.id, type: 'contains_evidence', certainty: 'direct', algorithm: ALGORITHMS.evidence, quotes: [{ field: ev.field, start: ev.start, end: ev.end, text: ev.text }] });
  }
  // Explicit references.
  const unresolved = [];
  for (const si of snapshot.items) {
    if (!repo) break;
    const refs = parseReferences(si, repo);
    const grouped = new Map();
    for (const r of refs) {
      if (r.repository && r.repository.toLowerCase() !== repo.toLowerCase()) {
        unresolved.push({ from: si.id, text: r.text, reason: 'other_repository' });
        continue;
      }
      const t = byNumber.get(r.number);
      if (!t) {
        unresolved.push({ from: si.id, text: r.text, reason: 'not_in_snapshot' });
        continue;
      }
      if (t.id === si.id) continue;
      const key = `${r.type}|${t.id}`;
      if (!grouped.has(key)) grouped.set(key, { type: r.type, to: t.id, quotes: [] });
      grouped.get(key).quotes.push({ field: r.field, start: r.start, end: r.end, text: r.text });
    }
    // A pull request that fixes #N also mentions it; keep only the stronger edge for the same pair.
    for (const g of grouped.values()) {
      if (g.type === 'references' && grouped.has(`fixes|${g.to}`)) continue;
      edges.push({ id: edgeId(g.type, si.id, g.to, ALGORITHMS.references), from: si.id, to: g.to, type: g.type, certainty: 'direct', algorithm: ALGORITHMS.references, quotes: g.quotes });
    }
  }
  unresolved.sort((a, b) => cmp(a.from, b.from) || cmp(a.text, b.text) || cmp(a.reason, b.reason));
  if (unresolved.length) warnings.push({ code: 'references_not_resolved', severity: 'info', message: `${unresolved.length} reference(s) name an item outside this snapshot or another repository; no edge was drawn for them.`, count: unresolved.length });
  // Release timeline.
  if (snapshot.release && snapshot.release.publishedAt) {
    const rid = `release:${snapshot.release.tag}`;
    nodes.push({ id: rid, type: 'release', tag: snapshot.release.tag, publishedAt: snapshot.release.publishedAt, source: snapshot.release.source });
    const pub = Date.parse(snapshot.release.publishedAt);
    for (const si of snapshot.items) {
      const created = Date.parse(si.createdAt);
      if (!Number.isFinite(created) || !Number.isFinite(pub) || created < pub) continue;
      edges.push({ id: edgeId('reported_after_release', si.id, rid, ALGORITHMS.release), from: si.id, to: rid, type: 'reported_after_release', certainty: 'direct', algorithm: ALGORITHMS.release, metadata: { createdAt: si.createdAt, publishedAt: snapshot.release.publishedAt, note: 'reported after the release; not evidence that the release caused it' } });
    }
  }
  // Candidate links.
  const cand = candidateLinks(snapshot, { includeNear, thresholds });
  for (const c of cand.edges) edges.push({ id: edgeId(c.type, c.from, c.to, ALGORITHMS.candidates), from: c.from, to: c.to, type: c.type, certainty: 'candidate', algorithm: ALGORITHMS.candidates, score: c.score, reasons: c.reasons });
  if (cand.stats.status === 'limit') warnings.push({ code: 'candidate_limit', severity: 'warning', message: `Only the first ${cand.stats.limits.MAX_ITEMS} items were compared for candidate links.` });
  if (cand.stats.truncatedItems.length) warnings.push({ code: 'tokens_truncated', severity: 'info', message: `${cand.stats.truncatedItems.length} item(s) are longer than the per-item token cap; only the start was compared.`, itemIds: cand.stats.truncatedItems });
  if (cand.suppressed.length) warnings.push({ code: 'conflicting_evidence', severity: 'info', message: `${cand.suppressed.length} candidate link(s) were not drawn because one report affirms what the other negates. Listed under suppressedCandidates for review.`, count: cand.suppressed.length });
  nodes.sort((a, b) => cmp(a.id, b.id));
  edges.sort((a, b) => cmp(a.id, b.id));
  const graph = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    kind: 'urgent-first-evidence-graph',
    engineVersion: VERSION,
    snapshotId: snapshot.snapshotId,
    algorithms: { ...ALGORITHMS },
    thresholds: { ...thresholds },
    nodes,
    edges,
    clusters: starClusters(edges),
    suppressedCandidates: cand.suppressed.map((s) => ({ ...s, id: edgeId(s.type, s.from, s.to, ALGORITHMS.candidates) })).sort((a, b) => cmp(a.id, b.id)),
    ...(includeNear ? { nearCandidates: cand.near } : {}),
    unresolvedReferences: unresolved,
    stats: { items: cand.stats.items, comparisons: cand.stats.comparisons, rareDfMax: cand.stats.rareDfMax, droppedByCap: cand.stats.droppedByCap, status: cand.stats.status, limits: cand.stats.limits },
    warnings,
  };
  return graph;
}
