// Release Pulse: what changed between two verified snapshots. Pure and read-only: it reads two snapshots (and
// their evidence graphs), never writes to them, and invents nothing.
//
// Identity matching only (src/snapshot/snapshot.js itemIdentity): repository + kind + number, or an explicit id.
// Two snapshots of different repositories are refused, never matched by number.
//  - new             identity absent from the older snapshot (uncertain when the older one is partial)
//  - changed         identity in both, and the content digest, the tier or the state differs
//  - resolved        identity in both, open before and closed upstream now, and only when both snapshots are
//                    complete with the same scope; otherwise a state change is shown with status uncertain
//  - not in newer    identity absent from the newer snapshot: never called resolved (closed, transferred,
//                    deleted or outside the scope; the snapshot cannot tell)
// Tier transitions name their cause: the item's content, its labels, the inherited link, or the pack. A lower
// tier in a later snapshot is a cross-run downgrade with that cause, never a lowering inside a run.
// A pack or engine change is reported as config_changed and every tier change it may explain says so.
// Release: only the release the GitHub API supplied; reports filed after it are "reported after release".
import { UserError, VERSION } from '../util.js';
import { canonicalJson, digestOf } from '../snapshot/canonical.js';
import { warning } from '../diagnostics.js';

export const PULSE_SCHEMA_VERSION = 1;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function baselineOf(snap) {
  return snap.pack.tiers[snap.pack.tiers.length - 1].id;
}

function rank(snap, tier) {
  const i = snap.pack.tiers.findIndex((t) => t.id === tier);
  return i === -1 ? Infinity : i;
}

/** Evidence of one item with provenance: rule, field, offsets, the exact quote, the evidence and snapshot ids. */
export function provenance(snap, si) {
  const ev = new Map(snap.evidence.map((e) => [e.id, e]));
  return si.evidenceIds.map((id) => ev.get(id)).filter(Boolean).map((e) => ({ evidenceId: e.id, ruleId: e.ruleId, tier: e.tier, category: e.category ?? null, kind: e.kind, field: e.field, start: e.start, end: e.end, text: e.text, context: e.context, snapshotId: snap.snapshotId }));
}

function afterRelease(snap, si) {
  if (!snap.release || !snap.release.publishedAt || !si.createdAt) return false;
  return Date.parse(si.createdAt) >= Date.parse(snap.release.publishedAt);
}

function brief(snap, si) {
  return { id: si.id, localId: si.localId, kind: si.kind, title: si.title, url: si.url, tier: si.effectiveTier, state: si.state, createdAt: si.createdAt, synthetic: si.synthetic, reportedAfterRelease: afterRelease(snap, si), evidence: provenance(snap, si) };
}

/** The shared words of a candidate edge for display, as the reports spelled them. */
export function sharedWords(e) {
  const r = (e?.reasons || []).find((x) => x.kind === 'shared_features');
  const list = r ? r.words || r.features.map((x) => x.replace(/^[wve]:/, '')) : [];
  return list.filter((x, i, arr) => arr.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).slice(0, 8);
}

function sameSource(a, b) {
  if (a.source.kind !== b.source.kind) return false;
  if (a.source.kind === 'github') return String(a.source.repository).toLowerCase() === String(b.source.repository).toLowerCase();
  return true;
}

/** Why one item's tier moved between the snapshots. */
function tierCause(older, newer, o, n, configChanged) {
  const causes = [];
  const contentChanged = o.contentDigest !== n.contentDigest;
  if (contentChanged) {
    if (canonicalJson(o.labels) !== canonicalJson(n.labels)) causes.push({ kind: 'labels_changed', before: o.labels, after: n.labels });
    if (o.title !== n.title || canonicalJson(o.text) !== canonicalJson(n.text)) causes.push({ kind: 'content_changed' });
    if (o.priority !== n.priority) causes.push({ kind: 'priority_changed', before: o.priority, after: n.priority });
  }
  const gained = n.ruleIds.filter((r) => !o.ruleIds.includes(r));
  const lost = o.ruleIds.filter((r) => !n.ruleIds.includes(r));
  // The pack's inheritance rule, whatever its id: evidence of kind inherited_link names it.
  const inherit = new Set([...older.evidence, ...newer.evidence].filter((e) => e.kind === 'inherited_link').map((e) => e.ruleId));
  if (!contentChanged && [...gained, ...lost].some((r) => inherit.has(r))) causes.push({ kind: 'linked_issue_changed' });
  if (configChanged) causes.push({ kind: 'pack_changed', before: older.pack.digest, after: newer.pack.digest });
  if (!causes.length) causes.push({ kind: 'other_items_changed', note: 'Same content and pack: the tier depends on other items of the run (boilerplate masking or a linked issue).' });
  return { causes, rulesGained: gained, rulesLost: lost };
}

/**
 * @param {object} older verified snapshot
 * @param {object} newer verified snapshot
 * @param {{olderGraph?: object, newerGraph?: object, gold?: Map<string, string>}} opts gold: identity or local id -> gold tier
 */
export function diffSnapshots(older, newer, { newerGraph = null, gold = null } = {}) {
  if (!sameSource(older, newer)) {
    throw new UserError(`The snapshots come from different sources (${older.source.repository || older.source.kind} and ${newer.source.repository || newer.source.kind}). Items are never matched across unrelated sources.`, { code: 2 });
  }
  const warnings = [];
  const configChanged = older.pack.digest !== newer.pack.digest || older.pack.id !== newer.pack.id || older.engineVersion !== newer.engineVersion;
  if (configChanged) warnings.push(warning('config_changed', `The pack or engine changed between the snapshots (${older.pack.id} ${older.pack.version} ${older.pack.digest.slice(0, 19)} -> ${newer.pack.id} ${newer.pack.version} ${newer.pack.digest.slice(0, 19)}${older.engineVersion !== newer.engineVersion ? `; engine ${older.engineVersion} -> ${newer.engineVersion}` : ''}). Tier changes may come from the configuration, not from the issues.`));
  const scopeSame = canonicalJson(older.source.scope) === canonicalJson(newer.source.scope);
  if (!scopeSame) warnings.push(warning('scope_mismatch', `The snapshots cover different scopes (${canonicalJson(older.source.scope)} and ${canonicalJson(newer.source.scope)}). No item is called resolved; items missing from one side may simply be outside its scope.`));
  const partial = older.status === 'partial' || newer.status === 'partial';
  if (partial) warnings.push(warning('partial_source', `${[older.status === 'partial' ? 'The older' : null, newer.status === 'partial' ? 'The newer' : null].filter(Boolean).join(' and ')} snapshot is partial. Counts of new and missing items cover only what was collected, and no item is called resolved.`));
  const canResolve = scopeSame && !partial && older.source.complete !== false && newer.source.complete !== false;
  const oldBy = new Map(older.items.map((i) => [i.id, i]));
  const newBy = new Map(newer.items.map((i) => [i.id, i]));
  const baseOld = baselineOf(older);
  const baseNew = baselineOf(newer);

  const added = [];
  const changed = [];
  const tierChanges = [];
  const resolved = [];
  const stateChanges = [];
  const notInNewer = [];
  for (const n of newer.items) {
    const o = oldBy.get(n.id);
    if (!o) {
      added.push({ ...brief(newer, n), status: older.status === 'partial' ? 'not_in_older_partial' : 'new' });
      continue;
    }
    const contentChanged = o.contentDigest !== n.contentDigest;
    const tierChanged = o.effectiveTier !== n.effectiveTier;
    const stateChanged = o.state !== n.state;
    if (contentChanged || tierChanged || stateChanged) changed.push({ id: n.id, localId: n.localId, contentChanged, tierChanged, stateChanged });
    if (tierChanged) {
      const direction = rank(newer, n.effectiveTier) < rank(older, o.effectiveTier) ? 'raised' : 'cross_run_downgrade';
      tierChanges.push({ ...brief(newer, n), before: o.effectiveTier, after: n.effectiveTier, direction, ...tierCause(older, newer, o, n, configChanged), previousEvidence: provenance(older, o) });
    }
    if (stateChanged) {
      if (canResolve && o.state === 'open' && n.state === 'closed') resolved.push({ ...brief(newer, n), before: o.effectiveTier, note: 'closed upstream (state from the GitHub API)' });
      else stateChanges.push({ ...brief(newer, n), before: o.state, after: n.state, status: 'uncertain' });
    }
  }
  for (const o of older.items) {
    if (newBy.has(o.id)) continue;
    notInNewer.push({ ...brief(older, o), status: 'not_in_newer_snapshot', note: 'Not in the newer snapshot: it may be closed, transferred, deleted or outside the scope. Not called resolved.' });
  }

  const newlyFlagged = newer.items
    .filter((n) => n.effectiveTier !== baseNew && (!oldBy.has(n.id) || oldBy.get(n.id).effectiveTier === baseOld))
    .sort((a, b) => a.boardPosition - b.boardPosition)
    .map((n) => ({ ...brief(newer, n), isNew: !oldBy.has(n.id) }));
  const unresolvedPrior = older.items
    .filter((o) => o.effectiveTier !== baseOld && newBy.has(o.id) && newBy.get(o.id).state !== 'closed')
    .map((o) => ({ ...brief(newer, newBy.get(o.id)), previousTier: o.effectiveTier }))
    .sort((a, b) => rank(newer, a.tier) - rank(newer, b.tier) || cmp(a.id, b.id));
  const priorFlaggedMissing = notInNewer.filter((x) => x.tier !== baseOld);

  const newIds = new Set(added.map((a) => a.id));
  const clusters = [];
  if (newerGraph) {
    const edgeById = new Map(newerGraph.edges.map((e) => [e.id, e]));
    for (const c of newerGraph.clusters || []) {
      const ids = [c.anchor, ...c.members.map((m) => m.id)];
      const fresh = ids.filter((id) => newIds.has(id));
      if (!fresh.length) continue;
      clusters.push({
        id: c.id,
        anchor: brief(newer, newBy.get(c.anchor)),
        members: c.members.map((m) => {
          const e = edgeById.get(m.edge);
          return { ...brief(newer, newBy.get(m.id)), linkType: m.type, score: m.score, edge: m.edge, sharedFeatures: sharedWords(e) };
        }),
        newMembers: fresh,
        reportedAfterRelease: ids.filter((id) => afterRelease(newer, newBy.get(id))).length,
      });
    }
  }

  let goldSection = null;
  if (gold) {
    const top = newer.pack.tiers[0].id;
    const labelled = newer.items.filter((si) => gold.has(si.id) || gold.has(si.localId));
    const goldTop = labelled.filter((si) => (gold.get(si.id) ?? gold.get(si.localId)) === top);
    const missed = goldTop.filter((si) => si.effectiveTier !== top).map((si) => ({ ...brief(newer, si), goldTier: top }));
    goldSection = { labelledItems: labelled.length, goldTopTier: goldTop.length, missed, note: 'Misses against the given labels only. Labels are a proxy, not ground truth.' };
  }

  const release = newer.release && newer.release.source === 'github-release-api' ? { tag: newer.release.tag, publishedAt: newer.release.publishedAt, source: newer.release.source, url: newer.release.url || null, previousTag: older.release ? older.release.tag : null, reportedAfter: newer.items.filter((si) => afterRelease(newer, si)).length, note: 'Reported after release is an order of timestamps, not a cause.' } : null;

  const side = (s) => ({ snapshotId: s.snapshotId, status: s.status, pack: { id: s.pack.id, version: s.pack.version, digest: s.pack.digest }, source: s.source, release: s.release || null, items: s.items.length, flagged: s.counts.flagged });
  const pulse = {
    schemaVersion: PULSE_SCHEMA_VERSION,
    kind: 'urgent-first-pulse',
    engineVersion: VERSION,
    status: partial ? 'partial' : 'complete',
    older: side(older),
    newer: side(newer),
    configChanged,
    scopeMatches: scopeSame,
    resolutionsAsserted: canResolve,
    release,
    counts: { new: added.length, notInNewer: notInNewer.length, changed: changed.length, tierChanges: tierChanges.length, resolved: resolved.length, newlyFlagged: newlyFlagged.length, unresolvedPrior: unresolvedPrior.length, clustersWithNewMembers: clusters.length },
    sections: { newlyFlagged, tierChanges, unresolvedPrior, priorFlaggedNotInNewer: priorFlaggedMissing, clustersWithNewMembers: clusters, goldMisses: goldSection },
    changes: { added: added.map((a) => a.id), notInNewer: notInNewer.map((x) => x.id), changed, resolved, stateChanges },
    warnings,
    visibility: { public: false, note: 'Local Pulse: contains item titles and quotes. Use --public for a sanitised projection.' },
  };
  pulse.pulseId = digestOf(pulse);
  return pulse;
}

// ---------------------------------------------------------------------------------------------------------
// Public projection: no bodies (they were never in the Pulse), quotes clipped, security reports withheld,
// only synthetic input unless the caller explicitly allows real data.

const SECURITY = (x) => x.evidence.some((e) => e.category === 'security' || /security/i.test(e.ruleId) || (e.kind === 'floor_label' && /security/i.test(e.text)));

function publicEntry(x) {
  if (SECURITY(x)) return { ...x, title: '[security report withheld]', url: null, evidence: [], withheld: 'security' };
  return { ...x, evidence: x.evidence.map((e) => ({ ...e, text: e.text.length > 80 ? `${e.text.slice(0, 79)}…` : e.text })) };
}

export function publicProjection(pulse, { allowReal = false, olderSnap, newerSnap }) {
  const allSynthetic = [...olderSnap.items, ...newerSnap.items].every((i) => i.synthetic === true);
  if (!allSynthetic && !allowReal) {
    throw new UserError('Refusing a public Pulse of data not marked synthetic. Public export is for synthetic demos by default; for real repository data add --allow-real-public-export and review every line before sharing.', { code: 2 });
  }
  const p = structuredClone(pulse);
  const S = p.sections;
  S.newlyFlagged = S.newlyFlagged.map(publicEntry);
  S.tierChanges = S.tierChanges.map((x) => ({ ...publicEntry(x), previousEvidence: SECURITY(x) ? [] : x.previousEvidence.map((e) => ({ ...e, text: e.text.length > 80 ? `${e.text.slice(0, 79)}…` : e.text })) }));
  S.unresolvedPrior = S.unresolvedPrior.map(publicEntry);
  S.priorFlaggedNotInNewer = S.priorFlaggedNotInNewer.map(publicEntry);
  S.clustersWithNewMembers = S.clustersWithNewMembers.map((c) => ({ ...c, anchor: publicEntry(c.anchor), members: c.members.map(publicEntry) }));
  if (S.goldMisses) S.goldMisses.missed = S.goldMisses.missed.map(publicEntry);
  p.changes.resolved = p.changes.resolved.map(publicEntry);
  p.changes.stateChanges = p.changes.stateChanges.map(publicEntry);
  p.visibility = allSynthetic
    ? { public: true, data: 'synthetic', note: 'Public projection of synthetic data: titles and short quotes only, no item bodies, security reports withheld.' }
    : { public: true, data: 'real', note: 'Public projection of REAL repository data, exported with --allow-real-public-export. Titles and short quotes only, no item bodies, security reports withheld. Review every line before sharing.' };
  delete p.pulseId;
  p.pulseId = digestOf(p);
  return p;
}
