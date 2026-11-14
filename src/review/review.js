// Maintainer review files: decisions on candidate links and on rule outputs, stored as annotations next to a
// snapshot. A review never changes the snapshot, the board or a pack. `calibrate` reads it to propose a pack
// patch for a human to inspect.
//
// Enums. candidate_link: confirmed | rejected | needs_context. triage: correct | missed_raise | false_raise | unclear.
// A null decision means "not reviewed yet" (review init writes them that way).
// The reviewer is a local alias, never an authenticated identity, and nothing is checked over the network.
// Bounds: alias 1-64 characters [A-Za-z0-9._-]; reason up to 500 characters; up to 10,000 decisions.
// A missed_raise needs suggestedTier (more urgent than the item's tier) and 1 to 4 quotes, each an exact substring
// of the item (the same locator as annotation merge); anything else is evidence_mismatch.
// Optional "signature" fields (per decision and top level) are kept and ignored, so signed records can be added
// later without a migration.
import { locateQuote, MIN_QUOTE_CHARS } from '../annotate.js';
import { snapshotItemAsItem } from '../snapshot/snapshot.js';
import { VERSION } from '../util.js';

export const REVIEW_SCHEMA_VERSION = 1;
export const DECISIONS = Object.freeze({ candidate_link: ['confirmed', 'rejected', 'needs_context'], triage: ['correct', 'missed_raise', 'false_raise', 'unclear'] });
export const LIMITS = Object.freeze({ alias: 64, reason: 500, decisions: 10000, quotes: 4 });
const ALIAS_RE = /^[A-Za-z0-9._-]{1,64}$/;

function label(si) {
  return `${si.localId} ${si.title}`.slice(0, 120);
}

/** A review file with every candidate link, every suppressed candidate and every flagged item left unreviewed. */
export function initReview(snapshot, graph, { reviewer = 'maintainer' } = {}) {
  const byId = new Map(snapshot.items.map((i) => [i.id, i]));
  const baseline = snapshot.pack.tiers[snapshot.pack.tiers.length - 1].id;
  const decisions = [];
  for (const e of graph.edges.filter((x) => x.certainty === 'candidate')) {
    decisions.push({ target: e.id, kind: 'candidate_link', decision: null, reason: '', about: `${e.type} ${byId.get(e.from).localId} ~ ${byId.get(e.to).localId} (score ${e.score})` });
  }
  for (const s of graph.suppressedCandidates || []) {
    decisions.push({ target: s.id, kind: 'candidate_link', decision: null, reason: '', about: `not linked (conflicting evidence) ${byId.get(s.from).localId} ~ ${byId.get(s.to).localId}` });
  }
  for (const si of snapshot.items.filter((i) => i.effectiveTier !== baseline).sort((a, b) => a.boardPosition - b.boardPosition)) {
    decisions.push({ target: si.id, kind: 'triage', decision: null, reason: '', about: `${si.effectiveTier} ${label(si)}` });
  }
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    kind: 'urgent-first-review',
    engineVersion: VERSION,
    snapshotId: snapshot.snapshotId,
    pack: { id: snapshot.pack.id, version: snapshot.pack.version, digest: snapshot.pack.digest },
    reviewer,
    note: 'Fill in decision for the targets you reviewed (candidate_link: confirmed, rejected, needs_context; triage: correct, missed_raise, false_raise, unclear). Add triage decisions for any other item id. A missed_raise needs suggestedTier and exact quotes. The reviewer is a local alias, not a verified identity.',
    decisions,
  };
}

/**
 * Validate a review against its snapshot and graph. Never throws on bad content: every problem is listed.
 * @returns {{valid: boolean, errors: {code, message, index?}[], counts: object, decisions: object[]}}
 */
export function checkReview(review, snapshot, graph) {
  const errors = [];
  const err = (code, message, index = undefined) => errors.push({ code, message, ...(index !== undefined ? { index } : {}) });
  if (!review || typeof review !== 'object') return { valid: false, errors: [{ code: 'invalid', message: 'not a JSON object' }], counts: {}, decisions: [] };
  if (review.schemaVersion !== REVIEW_SCHEMA_VERSION) err('schema_version', `schemaVersion must be ${REVIEW_SCHEMA_VERSION}`);
  if (review.kind !== undefined && review.kind !== 'urgent-first-review') err('kind', 'kind must be "urgent-first-review"');
  if (review.snapshotId !== snapshot.snapshotId) err('snapshot_mismatch', `the review is for ${review.snapshotId}, not ${snapshot.snapshotId}`);
  if (typeof review.reviewer !== 'string' || !ALIAS_RE.test(review.reviewer)) err('reviewer', `reviewer must be a local alias of 1-${LIMITS.alias} letters, digits, ".", "_" or "-"`);
  if (!Array.isArray(review.decisions)) {
    err('decisions', 'decisions must be an array');
    return { valid: false, errors, counts: {}, decisions: [] };
  }
  if (review.decisions.length > LIMITS.decisions) err('too_many', `at most ${LIMITS.decisions} decisions`);
  const items = new Map();
  for (const si of snapshot.items) {
    items.set(si.id, si);
    items.set(si.localId, si);
  }
  const edges = new Map(graph.edges.filter((e) => e.certainty === 'candidate').map((e) => [e.id, e]));
  for (const s of graph.suppressedCandidates || []) edges.set(s.id, s);
  const rank = (t) => snapshot.pack.tiers.findIndex((x) => x.id === t);
  const baseline = snapshot.pack.tiers[snapshot.pack.tiers.length - 1].id;
  const seen = new Set();
  const out = [];
  const counts = { total: review.decisions.length, reviewed: 0, unreviewed: 0, candidate_link: {}, triage: {} };
  review.decisions.forEach((d, i) => {
    if (!d || typeof d !== 'object') return err('invalid', 'decision is not an object', i);
    if (!Object.prototype.hasOwnProperty.call(DECISIONS, d.kind)) return err('kind', `kind must be candidate_link or triage (got ${JSON.stringify(d.kind)})`, i);
    if (typeof d.target !== 'string') return err('target', 'target must be a string', i);
    const key = `${d.kind}|${d.target}`;
    if (seen.has(key)) return err('duplicate_target', `${d.target} is reviewed twice`, i);
    seen.add(key);
    if (d.decision !== null && !DECISIONS[d.kind].includes(d.decision)) return err('decision', `${d.kind} decision must be one of ${DECISIONS[d.kind].join(', ')} or null (got ${JSON.stringify(d.decision)})`, i);
    if (d.reason !== undefined && (typeof d.reason !== 'string' || d.reason.length > LIMITS.reason)) return err('reason', `reason must be a string of at most ${LIMITS.reason} characters`, i);
    let resolved = null;
    if (d.kind === 'candidate_link') {
      if (!edges.has(d.target)) return err('unknown_target', `no candidate link ${d.target} in this snapshot's graph`, i);
      resolved = { target: d.target };
    } else {
      const si = items.get(d.target);
      if (!si) return err('unknown_target', `no item ${d.target} in this snapshot`, i);
      resolved = { target: si.id, localId: si.localId, tier: si.effectiveTier };
      if (d.decision === 'false_raise' && si.effectiveTier === baseline) return err('not_raised', `${si.localId} is not flagged, so it cannot be a false raise`, i);
      if (d.decision === 'missed_raise') {
        if (!snapshot.pack.tiers.some((t) => t.id === d.suggestedTier) || rank(d.suggestedTier) >= rank(si.effectiveTier)) return err('suggested_tier', `missed_raise needs suggestedTier more urgent than ${si.effectiveTier}`, i);
        if (!Array.isArray(d.quotes) || d.quotes.length < 1 || d.quotes.length > LIMITS.quotes) return err('quotes', `missed_raise needs 1 to ${LIMITS.quotes} quotes`, i);
        const spans = [];
        for (const q of d.quotes) {
          const span = typeof q === 'string' && q.length >= MIN_QUOTE_CHARS ? locateQuote(snapshotItemAsItem(si), q) : null;
          if (!span) return err('evidence_mismatch', `quote ${JSON.stringify(String(q).slice(0, 80))} is not an exact substring of ${si.localId} (at least ${MIN_QUOTE_CHARS} characters, case-sensitive)`, i);
          spans.push(span);
        }
        resolved.spans = spans;
        resolved.suggestedTier = d.suggestedTier;
      }
    }
    if (d.decision === null) counts.unreviewed++;
    else {
      counts.reviewed++;
      counts[d.kind][d.decision] = (counts[d.kind][d.decision] || 0) + 1;
    }
    out.push({ index: i, kind: d.kind, decision: d.decision, reason: d.reason || '', ...resolved });
  });
  return { valid: errors.length === 0, errors, counts, decisions: out };
}
