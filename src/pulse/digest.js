// The maintainer digest of one snapshot: three panes, all from verified data.
//   Discuss First       the snapshot's flagged items in board order, each with its exact quotes
//   Related Reports     direct links (fixes, references) with their quote, and candidate clusters
//   Since Last Snapshot the Release Pulse against --previous, or a note that there is none
// The graph is rebuilt from snapshot.json rather than read from disk, so an edited graph file cannot add links.
import { VERSION } from '../util.js';
import { buildGraph } from '../graph/build.js';
import { validateGraph } from '../graph/validate.js';
import { provenance } from './diff.js';

export function buildDigest(snapshot, { since = null } = {}) {
  const graph = buildGraph(snapshot);
  const problems = validateGraph(graph, snapshot);
  if (problems.length) throw new Error(`digest: graph failed validation: ${problems.join('; ')}`);
  const byId = new Map(snapshot.items.map((i) => [i.id, i]));
  const baseline = snapshot.pack.tiers[snapshot.pack.tiers.length - 1].id;
  const related = new Map();
  const note = (a, b) => {
    if (!related.has(a)) related.set(a, new Set());
    related.get(a).add(byId.get(b).localId);
  };
  const direct = [];
  for (const e of graph.edges) {
    if (e.type !== 'fixes' && e.type !== 'references') continue;
    direct.push({ id: e.id, type: e.type, from: e.from, to: e.to, fromLocal: byId.get(e.from).localId, toLocal: byId.get(e.to).localId, quote: e.quotes[0].text });
    note(e.from, e.to);
    note(e.to, e.from);
  }
  const clusters = graph.clusters.map((c) => {
    for (const m of c.members) {
      note(c.anchor, m.id);
      note(m.id, c.anchor);
    }
    return { id: c.id, anchor: c.anchor, anchorLocal: byId.get(c.anchor).localId, members: c.members.map((m) => ({ id: m.id, localId: byId.get(m.id).localId, type: m.type, score: m.score })) };
  });
  const after = (si) => Boolean(snapshot.release && si.createdAt && Date.parse(si.createdAt) >= Date.parse(snapshot.release.publishedAt));
  const discussFirst = snapshot.items
    .filter((si) => si.effectiveTier !== baseline)
    .sort((a, b) => a.boardPosition - b.boardPosition)
    .map((si) => ({ id: si.id, localId: si.localId, kind: si.kind, title: si.title, url: si.url, tier: si.effectiveTier, reportedAfterRelease: after(si), evidence: provenance(snapshot, si), related: [...(related.get(si.id) || [])].sort() }));
  return {
    schemaVersion: 1,
    kind: 'urgent-first-digest',
    engineVersion: VERSION,
    snapshotId: snapshot.snapshotId,
    status: snapshot.status,
    pack: snapshot.pack,
    source: snapshot.source,
    release: snapshot.release || null,
    counts: snapshot.counts,
    discussFirst,
    related: { direct, clusters },
    since,
    warnings: [...snapshot.warnings, ...graph.warnings],
  };
}
