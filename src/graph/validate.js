// Graph integrity checks (tests/graph.test.js runs them on every graph built in the tests, and `links`
// runs them before printing). Returns a list of problems; an empty list means the graph is sound.
//  - every edge refers to known node ids, and its id is the digest of (type, from, to, algorithm);
//  - direct edges are provable: contains_evidence, fixes and references quotes reproduce the original text
//    exactly, a fixes edge starts at a pull request, reported_after_release timestamps are in order;
//  - candidate edges are "candidate", of a candidate type, with a score in [0, 1];
//  - no node or edge carries a tier or a priority (the graph never assigns priority);
//  - no item has more than the cap of candidate links.
import { edgeId } from './build.js';
import { LIMITS } from './candidates.js';
import { snapshotItemAsItem, spanProblem } from '../snapshot/snapshot.js';

const DIRECT = new Set(['contains_evidence', 'fixes', 'references', 'reported_after_release']);
const CANDIDATE = new Set(['possible_duplicate', 'same_symptom']);
const PRIORITY_KEYS = ['tier', 'effectiveTier', 'priority', 'floorTier', 'raise_to', 'urgency'];

export function validateGraph(graph, snapshot) {
  const problems = [];
  if (graph.snapshotId !== snapshot.snapshotId) problems.push('graph snapshotId differs from the snapshot');
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const items = new Map(snapshot.items.map((si) => [si.id, si]));
  const ids = new Set();
  const degree = new Map();
  for (const n of graph.nodes) for (const k of PRIORITY_KEYS) if (k in n) problems.push(`node ${n.id} carries ${k}`);
  for (const e of graph.edges) {
    if (ids.has(e.id)) problems.push(`duplicate edge id ${e.id}`);
    ids.add(e.id);
    for (const k of PRIORITY_KEYS) if (k in e) problems.push(`edge ${e.id} carries ${k}`);
    if (!nodes.has(e.from) || !nodes.has(e.to)) problems.push(`edge ${e.id} refers to an unknown node`);
    if (edgeId(e.type, e.from, e.to, e.algorithm) !== e.id) problems.push(`edge ${e.id} id is not the digest of its type, ends and algorithm`);
    if (DIRECT.has(e.type)) {
      if (e.certainty !== 'direct') problems.push(`edge ${e.id} (${e.type}) must be direct`);
      if (e.type === 'reported_after_release') {
        const si = items.get(e.from);
        if (!si || !(Date.parse(si.createdAt) >= Date.parse(e.metadata.publishedAt))) problems.push(`edge ${e.id}: item was not reported after the release`);
        continue;
      }
      const owner = e.type === 'contains_evidence' ? items.get(e.from) : items.get(e.from);
      if (!owner) {
        problems.push(`edge ${e.id} starts at a non-item`);
        continue;
      }
      if (e.type === 'fixes' && owner.kind !== 'pull_request') problems.push(`edge ${e.id}: only a pull request can fix an issue`);
      if (!Array.isArray(e.quotes) || !e.quotes.length) problems.push(`edge ${e.id} has no quote`);
      for (const q of e.quotes || []) {
        const p = spanProblem(snapshotItemAsItem(owner), q);
        if (p) problems.push(`edge ${e.id}: ${p}`);
      }
    } else if (CANDIDATE.has(e.type)) {
      if (e.certainty !== 'candidate') problems.push(`edge ${e.id} (${e.type}) must be a candidate`);
      if (!(typeof e.score === 'number' && e.score >= 0 && e.score <= 1)) problems.push(`edge ${e.id} score out of range`);
      for (const x of [e.from, e.to]) degree.set(x, (degree.get(x) || 0) + 1);
    } else problems.push(`edge ${e.id} has unknown type ${e.type}`);
  }
  for (const [id, d] of degree) if (d > LIMITS.MAX_LINKS) problems.push(`${id} has ${d} candidate links (cap ${LIMITS.MAX_LINKS})`);
  for (const c of graph.clusters || []) {
    for (const m of c.members) {
      const e = graph.edges.find((x) => x.id === m.edge);
      if (!e || !((e.from === c.anchor && e.to === m.id) || (e.to === c.anchor && e.from === m.id))) problems.push(`cluster ${c.id}: member ${m.id} has no direct candidate link to the anchor`);
    }
  }
  return problems;
}
