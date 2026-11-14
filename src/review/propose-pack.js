// calibrate: turn a checked review into a PROPOSED pack patch and development cases. Nothing here writes to a
// pack: the proposal, the candidate pack and the cases go to a separate folder for a human to inspect and apply.
//
//  - missed_raise decisions become proposed rules (one per suggested tier) whose patterns are the reviewer's
//    exact quotes, with the reviewed items as evidence examples and false_raise items as counterexamples;
//  - false_raise decisions become "review_rule" proposals naming the rule that raised the item;
//  - every reviewed item becomes a development case (positives, hard negatives, confirmed cases), except items
//    that also appear in a held-out set (same id or same content): those are left out and reported, so review
//    feedback can never leak into held-out labels;
//  - the candidate pack (base + proposed rules) is checked against the schema and the semantic checks, each
//    pattern is probed in a negated sentence, and it is evaluated before and after on the development cases and
//    on the untouched held-out set. Misses are listed first. A drop in held-out top-tier recall or a rise in false
//    flags is called a regression, never an improvement.
import fs from 'node:fs';
import path from 'node:path';
import { VERSION, readJson } from '../util.js';
import { compilePack, semanticErrors, SCHEMA_DIR } from '../pack.js';
import { validate } from '../jsonschema.js';
import { evaluateLabelled } from '../eval.js';
import { normalizeItems } from '../items.js';
import { loadItems } from '../adapters/index.js';
import { prepareItem, evaluate } from '../match/conditions.js';
import { contentDigest, packDigest } from '../snapshot/snapshot.js';

function rawPack(pack) {
  if (pack._file && fs.existsSync(pack._file)) return readJson(pack._file);
  return Object.fromEntries(Object.entries(pack).filter(([k]) => !k.startsWith('_')));
}

function summary(m) {
  return {
    items: m.items,
    missed_top_tier: m.missed_critical.map((x) => x.id),
    top_tier_caught: m.critical_sensitivity.caught,
    top_tier_total: m.critical_sensitivity.total,
    top_tier_recall: m.critical_sensitivity.value,
    top_tier_wilson95: m.critical_sensitivity.wilson95,
    false_flags: m.false_flag_rate.count,
    false_flag_rate: m.false_flag_rate.value,
    over_triage: m.over_triage_rate.count,
  };
}

function compare(before, after) {
  return {
    before,
    after,
    delta: {
      top_tier_caught: after.top_tier_caught - before.top_tier_caught,
      false_flags: after.false_flags - before.false_flags,
      over_triage: after.over_triage - before.over_triage,
    },
    newly_missed: after.missed_top_tier.filter((x) => !before.missed_top_tier.includes(x)),
    newly_caught: before.missed_top_tier.filter((x) => !after.missed_top_tier.includes(x)),
  };
}

/**
 * @param {object} o
 * @param {object} o.pack compiled base pack
 * @param {object} o.snapshot verified snapshot the review is about
 * @param {object} o.checked checkReview() result (valid)
 * @param {string[]} o.heldoutFiles labelled held-out files (never modified, never used for patterns)
 */
export function proposePatch({ pack, snapshot, checked, heldoutFiles = [] }) {
  const warnings = [];
  const byId = new Map(snapshot.items.map((i) => [i.id, i]));
  const baseline = pack._baseline;
  // Held-out guard.
  const held = [];
  for (const f of heldoutFiles) held.push(...loadItems(f).items);
  const heldIds = new Set(held.map((x) => x.id));
  const heldDigests = new Set(held.map((x) => contentDigest(x)));
  const leaks = [];
  const usable = checked.decisions.filter((d) => d.kind === 'triage' && d.decision && d.decision !== 'unclear').filter((d) => {
    const si = byId.get(d.target);
    if (heldIds.has(si.localId) || heldDigests.has(si.contentDigest)) {
      leaks.push(si.localId);
      return false;
    }
    return true;
  });
  if (leaks.length) warnings.push({ code: 'heldout_leak_blocked', message: `${leaks.length} reviewed item(s) also appear in a held-out set and were left out of the development cases and the patterns.`, itemIds: leaks.sort() });

  // Development cases.
  const cases = usable.map((d) => {
    const si = byId.get(d.target);
    const tier = d.decision === 'missed_raise' ? d.suggestedTier : d.decision === 'false_raise' ? baseline : si.effectiveTier;
    const category = { missed_raise: 'review_missed_raise', false_raise: 'review_false_raise', correct: 'review_confirmed' }[d.decision];
    return { id: `review-${si.localId}`, title: si.title, text: si.text, labels: si.labels, priority: si.priority, synthetic: true, metadata: { reviewed_from: si.id, snapshotId: snapshot.snapshotId }, gold: { tier, category, rationale: (d.reason || d.decision).slice(0, 300) } };
  });

  // Proposed rules.
  const proposedRules = [];
  const tiers = [...new Set(usable.filter((d) => d.decision === 'missed_raise').map((d) => d.suggestedTier))].sort();
  const counter = usable.filter((d) => d.decision === 'false_raise').map((d) => `review-${byId.get(d.target).localId}`);
  tiers.forEach((tier, n) => {
    const ds = usable.filter((d) => d.decision === 'missed_raise' && d.suggestedTier === tier);
    const patterns = [...new Set(ds.flatMap((d) => d.spans.map((s) => s.text)))].sort();
    proposedRules.push({
      id: `PROPOSED-${tier}-${n + 1}`,
      action: 'add',
      suggestedTier: tier,
      patterns,
      evidenceExamples: ds.map((d) => `review-${byId.get(d.target).localId}`),
      counterexamples: counter,
      rationale: ds.map((d) => d.reason).filter(Boolean).join(' / ').slice(0, 500) || 'Reviewed items the rules did not raise.',
    });
  });
  for (const d of usable.filter((x) => x.decision === 'false_raise')) {
    const si = byId.get(d.target);
    proposedRules.push({ id: `REVIEW-${si.ruleIds[0] || 'FLOOR'}`, action: 'review_rule', ruleId: si.ruleIds[0] || null, counterexamples: [`review-${si.localId}`], rationale: d.reason || 'Reviewed as a false raise.' });
  }

  // Candidate pack: base + added rules (never written into the pack folder).
  const raw = rawPack(pack);
  const candidateRaw = structuredClone(raw);
  for (const r of proposedRules.filter((x) => x.action === 'add')) {
    candidateRaw.rules.push({ id: r.id, tier: r.suggestedTier, category: 'proposed', title: `Proposed from review (${r.evidenceExamples.length} example(s))`, why: r.rationale, source: { citation: 'Maintainer review (local), not yet verified', url: 'https://github.com/logitsolutionsai/urgent-first/blob/main/docs/MAINTAINER-RADAR.md#review-calibrate-and-pack-lint' }, match: { terms: r.patterns } });
  }
  candidateRaw.version = `${raw.version}-proposed`;
  const schemaErrors = validate(readJson(path.join(SCHEMA_DIR, 'pack.schema.json')), candidateRaw);
  const semErrors = semanticErrors(candidateRaw);
  const checks = { schema: schemaErrors, semantic: semErrors, negation: [] };
  let evaluation = null;
  if (!schemaErrors.length && !semErrors.length) {
    const candidate = compilePack(candidateRaw, null);
    for (const r of proposedRules.filter((x) => x.action === 'add')) {
      const rule = candidate._rules.get(r.id);
      for (const p of r.patterns) {
        const probe = normalizeItems([{ id: 'probe', title: '', text: { body: `There was no ${p}.` } }])[0];
        const hit = evaluate(rule.match, prepareItem(probe, candidate), rule.id);
        checks.negation.push({ ruleId: r.id, pattern: p, probe: `There was no ${p}.`, firesWhenNegated: Boolean(hit.ok && hit.evidence.length) });
      }
    }
    if (checks.negation.some((x) => x.firesWhenNegated)) warnings.push({ code: 'fires_when_negated', message: 'A proposed pattern still matches in a negated sentence. Rephrase it before applying.' });
    const run = (p, items) => summary(evaluateLabelled(items, p, {}).rules_only);
    const dev = cases.length ? normalizeItems(cases) : [];
    evaluation = {
      development: dev.length ? compare(run(pack, dev), run(candidate, dev)) : null,
      heldout: held.length ? compare(run(pack, held), run(candidate, held)) : null,
    };
    const h = evaluation.heldout;
    let verdict = 'not_evaluated';
    if (h) {
      if (h.delta.top_tier_caught < 0 || h.delta.false_flags > 0) verdict = 'regression';
      else if (h.delta.top_tier_caught === 0 && h.delta.false_flags === 0 && h.delta.over_triage === 0) verdict = 'no_change_on_heldout';
      else verdict = 'no_heldout_regression';
    }
    evaluation.verdict = verdict;
    if (verdict === 'regression') warnings.push({ code: 'heldout_regression', message: 'On the held-out set the proposal misses more top-tier items or flags more baseline items. Do not apply it as it stands.' });
  } else warnings.push({ code: 'invalid_candidate_pack', message: 'The candidate pack fails the schema or the semantic checks; it was not evaluated.' });

  return {
    proposal: {
      schemaVersion: 1,
      kind: 'urgent-first-pack-proposal',
      engineVersion: VERSION,
      packId: pack.name,
      basePackDigest: packDigest(pack),
      snapshotId: snapshot.snapshotId,
      proposedRules,
      testStatus: 'not-yet-verified',
      active: false,
      checks,
      evaluation,
      heldoutFiles: heldoutFiles.map((f) => path.basename(f)),
      warnings,
      note: 'A proposal is never active. A maintainer reviews candidate-pack.json, moves what they accept into the pack by hand, adds the development cases to the development set (never to a held-out set), and re-runs eval.',
    },
    cases,
    candidateRaw,
  };
}
