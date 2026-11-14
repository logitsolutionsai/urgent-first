// Evaluate a pack on labelled items (each with gold.tier).
import { triage } from './engine.js';
import { mergeAnnotations } from './annotate.js';
import { stripGold } from './items.js';
import { tierRank } from './pack.js';
import { wilson, kendallTauB, round, pct } from './stats.js';
import { UserError } from './util.js';

function metrics(result, goldById, pack) {
  const top = pack._top;
  const baseline = pack._baseline;
  const tiers = pack.tiers.map((t) => t.id);
  const confusion = {};
  for (const g of tiers) {
    confusion[g] = {};
    for (const p of tiers) confusion[g][p] = 0;
  }
  let goldTop = 0;
  let caughtTop = 0;
  let over = 0;
  let notTopTotal = 0;
  let under = 0;
  let exact = 0;
  let goldBaseline = 0;
  let falseFlags = 0;
  const missed = [];
  const rules = new Map(pack.rules.map((r) => [r.id, { id: r.id, tier: r.tier, hits: 0, gold_at_least_rule_tier: 0, gold_less_urgent: 0 }]));
  // A pull request that inherits its linked issue's tier: the rule's tier is that issue's tier.
  if (pack.inherit) rules.set(pack.inherit.id, { id: pack.inherit.id, tier: 'inherited', hits: 0, gold_at_least_rule_tier: 0, gold_less_urgent: 0 });
  const positions = [];
  const goldKeys = [];
  for (const r of result.items) {
    const gold = goldById.get(r.id);
    const g = gold.tier;
    confusion[g][r.tier]++;
    const gr = tierRank(pack, g);
    const pr = tierRank(pack, r.tier);
    if (pr === gr) exact++;
    if (g === top) {
      goldTop++;
      if (r.tier === top) caughtTop++;
      else missed.push({ id: r.id, predicted: r.tier, gold_category: gold.category ?? null, title: r.title, rationale: gold.rationale ?? null });
    } else {
      notTopTotal++;
      if (pr < gr) over++;
    }
    if (pr > gr) under++;
    if (g === baseline) {
      goldBaseline++;
      if (r.tier !== baseline) falseFlags++;
    }
    for (const m of r.rules) {
      const s = rules.get(m.id);
      s.hits++;
      if (gr <= tierRank(pack, m.tier)) s.gold_at_least_rule_tier++;
      else s.gold_less_urgent++;
    }
    positions.push(r.position);
    goldKeys.push(gr * 100000 + (Number.isFinite(gold.rank) ? gold.rank : 0));
  }
  const sens = wilson(caughtTop, goldTop);
  const n = result.items.length;
  return {
    items: n,
    gold_counts: Object.fromEntries(tiers.map((t) => [t, tiers.reduce((acc, p) => acc + confusion[t][p], 0)])),
    critical_tier: top,
    critical_sensitivity: {
      caught: caughtTop,
      total: goldTop,
      value: round(sens.p, 4),
      wilson95: [round(sens.lower, 4), round(sens.upper, 4)],
    },
    missed_critical: missed,
    over_triage_rate: { count: over, total: notTopTotal, value: notTopTotal ? round(over / notTopTotal, 4) : null },
    false_flag_rate: { count: falseFlags, total: goldBaseline, value: goldBaseline ? round(falseFlags / goldBaseline, 4) : null },
    under_triage_rate: { count: under, total: n, value: n ? round(under / n, 4) : null },
    exact_tier_agreement: { count: exact, total: n, value: n ? round(exact / n, 4) : null },
    kendall_tau_b: round(kendallTauB(positions, goldKeys), 4),
    flags: flagMetrics(result, goldById, pack),
    confusion,
    rule_hits: [...rules.values()],
  };
}

/**
 * @param {object[]} items normalised items with gold
 * @param {object} pack compiled pack
 * @param {{annotations?: object[], now?: string}} opts
 */
export function evaluateLabelled(items, pack, { annotations = null, now = null, inputLabel = null, templates = null } = {}) {
  const missing = items.filter((it) => !it.gold || !pack._tierRank.has(it.gold.tier)).map((it) => it.id);
  if (missing.length) {
    throw new UserError(`${missing.length} labelled item(s) lack a valid gold.tier`, { details: missing.slice(0, 20).map((id) => `no valid gold.tier: ${id}`) });
  }
  const goldById = new Map(items.map((it) => [it.id, it.gold]));
  const plain = items.map(stripGold);
  const rulesResult = triage(plain, pack, { now, inputLabel, templates });
  const out = {
    pack: { name: pack.name, version: pack.version, mode: pack.mode, ...(pack.mode === 'research' ? { banner: pack.banner } : {}) },
    input: inputLabel,
    rules_only: metrics(rulesResult, goldById, pack),
    with_annotations: null,
    annotation_validation: null,
  };
  if (annotations) {
    const itemsById = new Map(plain.map((it) => [it.id, it]));
    const merged = mergeAnnotations(rulesResult, pack, annotations, itemsById);
    out.with_annotations = metrics(merged, goldById, pack);
    out.annotation_validation = merged.annotations;
  }
  return out;
}

/**
 * Flag-level metrics: an item is "flagged" when it is placed above the baseline (Discuss First), and "urgent"
 * when its gold tier is above the baseline.
 *   recall    = urgent items flagged / urgent items        (with a Wilson 95% interval)
 *   precision = urgent items flagged / items flagged      (with a Wilson 95% interval); null when nothing is flagged
 *   false-flag rate = baseline items flagged / baseline items
 * Precision is what a maintainer feels: of the items on the Discuss First list, how many deserved to be there.
 */
export function flagMetrics(result, goldById, pack) {
  const baseline = pack._baseline;
  let urgent = 0;
  let urgentFlagged = 0;
  let flagged = 0;
  let base = 0;
  let baseFlagged = 0;
  for (const r of result.items) {
    const g = goldById.get(r.id).tier;
    const isFlagged = r.tier !== baseline;
    if (isFlagged) flagged++;
    if (g !== baseline) {
      urgent++;
      if (isFlagged) urgentFlagged++;
    } else {
      base++;
      if (isFlagged) baseFlagged++;
    }
  }
  const ci = (x, n) => {
    const w = wilson(x, n);
    return { count: x, total: n, value: n ? round(w.p, 4) : null, wilson95: n ? [round(w.lower, 4), round(w.upper, 4)] : null };
  };
  return { recall: ci(urgentFlagged, urgent), precision: ci(urgentFlagged, flagged), false_flag_rate: ci(baseFlagged, base) };
}

function fmtSens(m) {
  const s = m.critical_sensitivity;
  if (!s.total) return 'n/a (no gold items in the critical tier)';
  return `${s.caught}/${s.total} = ${pct(s.value)} (Wilson 95% CI ${pct(s.wilson95[0])} to ${pct(s.wilson95[1])})`;
}

export function formatEvalText(report, pack) {
  const L = [];
  const cols = report.with_annotations ? ['rules only', 'rules + annotations'] : ['rules only'];
  const ms = report.with_annotations ? [report.rules_only, report.with_annotations] : [report.rules_only];
  const top = report.rules_only.critical_tier;
  L.push(`urgent-first eval · pack ${report.pack.name} ${report.pack.version} · ${report.input || ''}`);
  L.push(`Items: ${report.rules_only.items} · gold: ${Object.entries(report.rules_only.gold_counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  L.push('');
  ms.forEach((m, i) => {
    L.push(`== ${cols[i]} ==`);
    L.push(`${top} sensitivity (headline): ${fmtSens(m)}`);
    L.push(`Missed ${top} items: ${m.missed_critical.length}`);
    for (const x of m.missed_critical) L.push(`  - ${x.id} -> ${x.predicted} [${x.gold_category}] ${x.title}${x.rationale ? ` | gold: ${x.rationale}` : ''}`);
    L.push(`Over-triage (placed above gold, among non-${top} items): ${m.over_triage_rate.count}/${m.over_triage_rate.total} = ${pct(m.over_triage_rate.value)}`);
    L.push(`False flags (gold baseline placed above baseline): ${m.false_flag_rate.count}/${m.false_flag_rate.total} = ${pct(m.false_flag_rate.value)}`);
    L.push(`Under-triage (placed below gold, any tier): ${m.under_triage_rate.count}/${m.under_triage_rate.total} = ${pct(m.under_triage_rate.value)}`);
    const f = m.flags;
    L.push(`Flagged (above ${pack._baseline}): ${f.precision.total} · precision ${f.precision.count}/${f.precision.total} = ${pct(f.precision.value)} · recall of gold above ${pack._baseline} ${f.recall.count}/${f.recall.total} = ${pct(f.recall.value)}`);
    L.push(`Exact tier agreement: ${pct(m.exact_tier_agreement.value)}`);
    L.push(`Ranking quality (Kendall tau-b, board position vs gold tier): ${m.kendall_tau_b === null ? 'n/a' : m.kendall_tau_b.toFixed(3)}`);
    L.push('Confusion matrix (rows gold, columns predicted):');
    const tiers = Object.keys(m.confusion);
    L.push(`  gold\\pred ${tiers.map((t) => t.padStart(5)).join('')}`);
    for (const g of tiers) L.push(`  ${g.padEnd(9)} ${tiers.map((p) => String(m.confusion[g][p]).padStart(5)).join('')}`);
    L.push('Rule hits (items matched · gold at least as urgent as the rule · gold less urgent):');
    for (const r of m.rule_hits) L.push(`  ${r.id.padEnd(28)} ${String(r.hits).padStart(4)} ${String(r.gold_at_least_rule_tier).padStart(4)} ${String(r.gold_less_urgent).padStart(4)}`);
    L.push('');
  });
  if (report.annotation_validation) {
    const v = report.annotation_validation;
    L.push(`Annotations: ${v.accepted} accepted (${v.applied} raised a tier), ${v.rejected} rejected`);
    for (const r of v.rejected_list) L.push(`  - line ${r.line} (${r.item_id}): ${r.reasons.join('; ')}`);
  }
  void pack;
  return L.join('\n');
}

/** Markdown results table used in READMEs. */
export function resultsTable(rows) {
  const L = [];
  L.push('| Split | Items | Gold T1 | T1 caught | T1 sensitivity (Wilson 95% CI) | Missed T1 | Over-triage | False flags | Kendall tau-b |');
  L.push('| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |');
  for (const { split, m } of rows) {
    const s = m.critical_sensitivity;
    L.push(
      `| ${split} | ${m.items} | ${s.total} | ${s.caught} | ${pct(s.value)} (${pct(s.wilson95[0])} to ${pct(s.wilson95[1])}) | ${m.missed_critical.length} | ${pct(m.over_triage_rate.value)} | ${pct(m.false_flag_rate.value)} | ${m.kendall_tau_b === null ? 'n/a' : m.kendall_tau_b.toFixed(3)} |`,
    );
  }
  return L.join('\n');
}
