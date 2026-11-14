// Errors and caveats as first-class objects. Each has a stable `code`, a severity, a plain message and the
// item identities it concerns, so the HTML views, the Markdown views and --json all show the same list.
//
// Codes (docs/SNAPSHOT-SCHEMA.md#warnings):
//   partial_source              the collection stopped early; totals are not complete
//   rate_limit_truncation       ... because of a GitHub rate limit
//   unknown_release             a GitHub source without release metadata: no release marker is shown
//   unknown_priority            a priority value the pack's floor map does not know: it set no floor
//   ambiguous_negation          a top-tier rule term appeared negated or historical and did not count
//   excessive_template_masking  most of an item's text was masked as template text
//   missing_category            a rule matched that has no category (eval cannot group its misses)
//   evidence_mismatch           a quote that does not reproduce the item's text (review check, verification)
//   scope_mismatch, config_changed, unrelated_sources, item_identity_unknown   (diff, src/pulse/diff.js)

export const SEVERITY = { partial_source: 'warning', rate_limit_truncation: 'warning', unknown_release: 'info', unknown_priority: 'warning', ambiguous_negation: 'info', excessive_template_masking: 'warning', missing_category: 'info', evidence_mismatch: 'error' };

export function warning(code, message, itemIds = [], extra = {}) {
  return { code, severity: SEVERITY[code] || 'warning', message, itemIds: [...itemIds].sort(), ...extra };
}

const MASKED_SHARE = 0.6;

/** Diagnostics computed from a snapshot under construction and the engine result. Deterministic order. */
export function diagnose({ snapshot, pack }) {
  const out = [];
  const src = snapshot.source;
  if (src.complete === false) {
    out.push(warning('partial_source', `The collection is partial (${src.reason}). Totals and "new" or "not in newer snapshot" counts cover only what was collected.`, [], { reason: src.reason }));
    if (src.reason === 'rate_limit') out.push(warning('rate_limit_truncation', 'GitHub rate limit reached before the last page. Set GITHUB_TOKEN or GH_TOKEN, wait for the reset, and take the snapshot again.'));
  }
  if (src.kind === 'github' && !snapshot.release) out.push(warning('unknown_release', 'The GitHub API returned no latest release for this repository, so no item is marked "reported after release".'));
  const unknown = snapshot.items.filter((i) => i.unknownPriority !== undefined);
  if (unknown.length) out.push(warning('unknown_priority', `${unknown.length} item(s) have a priority value the pack does not map, so it set no floor: check them by hand.`, unknown.map((i) => i.id), { values: [...new Set(unknown.map((i) => i.unknownPriority))].sort() }));
  const top = pack._top;
  const topRules = new Set(pack.rules.filter((r) => r.tier === top).map((r) => r.id));
  const amb = snapshot.items.filter((i) => i.suppressed.some((s) => topRules.has(s.ruleId) && !i.ruleIds.includes(s.ruleId)));
  if (amb.length) out.push(warning('ambiguous_negation', `${amb.length} item(s) mention a ${top} rule term that was read as negated or historical, so it did not count. Read them by hand.`, amb.map((i) => i.id)));
  const heavy = snapshot.items.filter((i) => {
    const total = Object.values(i.text).reduce((n, v) => n + v.length, 0);
    const masked = i.masked.reduce((n, m) => n + (m.end - m.start), 0);
    return total >= 80 && masked / total >= MASKED_SHARE;
  });
  if (heavy.length) out.push(warning('excessive_template_masking', `${heavy.length} item(s) had at least ${Math.round(MASKED_SHARE * 100)}% of their text masked as template or boilerplate. The rules read little of what the reporter wrote: read them by hand.`, heavy.map((i) => i.id)));
  const noCat = new Set();
  const noCatItems = [];
  for (const i of snapshot.items) {
    for (const id of i.ruleIds) {
      const def = pack._rules.get(id);
      if (def && !def.category) {
        noCat.add(id);
        noCatItems.push(i.id);
      }
    }
  }
  if (noCat.size) out.push(warning('missing_category', `Rule(s) ${[...noCat].sort().join(', ')} matched but have no category, so eval cannot group their misses.`, [...new Set(noCatItems)]));
  return out;
}
