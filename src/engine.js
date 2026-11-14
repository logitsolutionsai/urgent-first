// The deterministic triage engine.
//
// For every item:
//   1. floor  = the tier implied by the item's own priority field and labels (pack.floor).
//   2. rules  = every pack rule whose match tree is true AND yields at least one quotable evidence span.
//   3. tier   = the most urgent of the floor and the matched rules' tiers. Rules can only raise.
//   4. clocks and SLA give a deadline used to order items inside a tier.
// Board order: flagged tiers (most urgent first; inside a tier by earliest deadline, then longest wait,
// then original order), then every baseline item in its original order.
// The same items, pack and `now` always give byte-identical results.

import { UserError, parseTime, isoOrNull, VERSION } from './util.js';
import { prepareItem, evaluate, getClocks, labelMatches } from './match/conditions.js';
import { tierRank, tierById } from './pack.js';
import { computeMasks } from './mask.js';
import { maskTemplateText } from './match/text.js';
import { fieldValue } from './items.js';

function priorityEvidence(item) {
  return { field: 'priority', start: 0, end: item.priority.length, text: item.priority, context: 'affirmed' };
}

/** Compute the floor tier of one item. Returns { tier, reasons, error, unknown }. */
export function computeFloor(item, pack) {
  const reasons = [];
  let tier = pack._baseline;
  let error = null;
  let unknown = null;
  if (item.priority === null) {
    if (pack.floor.missing_priority === 'error') error = 'missing priority (this pack requires one; it never guesses a priority)';
  } else {
    const mapped = pack._priorityMap.get(item.priority.toLowerCase());
    if (mapped) {
      // Only a floor above the baseline is worth showing; "routine sets the baseline" says nothing.
      if (mapped !== pack._baseline) reasons.push({ kind: 'priority', tier: mapped, evidence: [priorityEvidence(item)] });
      if (tierRank(pack, mapped) < tierRank(pack, tier)) tier = mapped;
    } else if (pack.floor.unknown_priority === 'error') {
      error = `unknown priority "${item.priority}" (known: ${[...pack._priorityMap.keys()].join(', ')})`;
    } else {
      // Not refused, but never silent: "P0" or "Sev1" in a pack that only knows P1 to P4 sets no floor.
      unknown = item.priority;
    }
  }
  item.labels.forEach((label, i) => {
    for (const rule of pack.floor.labels) {
      if (labelMatches(label.toLowerCase(), rule.match)) {
        reasons.push({ kind: 'label', tier: rule.tier, evidence: [{ field: `labels[${i}]`, start: 0, end: label.length, text: label, context: 'affirmed' }] });
        if (tierRank(pack, rule.tier) < tierRank(pack, tier)) tier = rule.tier;
        break;
      }
    }
  });
  return { tier, reasons, error, unknown };
}

/**
 * Put the most telling quote first (a suspected mention that quotes its cue, such as "r/o PE", else the
 * longest); the rest stay in text order. A word that is only suspected because a "?" follows it, as in an
 * issue template's "Does this occur when all extensions are disabled?", gets no head start.
 */
function primaryFirst(sorted) {
  let best = 0;
  const score = (x) => (x.cued ? 1000 : 0) + (x.end - x.start);
  sorted.forEach((x, i) => {
    if (score(x) > score(sorted[best])) best = i;
  });
  return best === 0 ? sorted : [sorted[best], ...sorted.slice(0, best), ...sorted.slice(best + 1)];
}

/** Sort spans and drop any span that lies inside a longer (or an identical, earlier) span of the same field. */
function sortEvidence(evidence) {
  const sorted = [...evidence].sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : a.start - b.start || b.end - a.end));
  // Sorted by start, then longest first: a span is covered exactly when an earlier span of its field reaches
  // at least as far. One pass, so a log with thousands of hits stays linear.
  const out = [];
  let field = null;
  let reach = -Infinity;
  for (const x of sorted) {
    if (x.field !== field) {
      field = x.field;
      reach = -Infinity;
    }
    if (reach >= x.end) continue;
    out.push(x);
    reach = x.end;
  }
  return out;
}

/**
 * Evaluate one item. Pure function of (item, pack, masks, inherited).
 * `masks`: template and boilerplate ranges the rules do not read (src/mask.js).
 * `inherited`: a pull request's link to a flagged issue it fixes (see linkPass), added like a matched rule.
 */
export function evaluateItem(item, pack, index, { masks = null, inherited = null } = {}) {
  const doc = prepareItem(item, pack, masks);
  const floor = computeFloor(item, pack);
  const rules = [];
  const silent = [];
  for (const rule of pack.rules) {
    const r = evaluate(rule.match, doc, rule.id);
    if (!r.ok) continue;
    if (!r.evidence.length) {
      silent.push(rule.id);
      continue;
    }
    rules.push({
      id: rule.id,
      tier: rule.tier,
      title: rule.title,
      why: rule.why,
      category: rule.category || null,
      source: rule.source,
      evidence: primaryFirst(sortEvidence(r.evidence)),
    });
  }
  if (inherited) rules.push(inherited);
  let tier = floor.tier;
  for (const r of rules) if (tierRank(pack, r.tier) < tierRank(pack, tier)) tier = r.tier;

  const createdMs = parseTime(item.created_at);
  // Clocks: only those named by a matched rule (in its match tree or its "clocks" list), so a
  // "last known well" time is shown for a stroke flag and not for an unrelated item.
  const clockNames = new Set();
  for (const r of rules) {
    const def = pack._rules.get(r.id);
    if (!def) continue;
    for (const n of def.clocks || []) clockNames.add(n);
    collectClockNames(def.match, clockNames);
  }
  const clocks = [];
  if (tier !== pack._baseline) {
    for (const [name, def] of Object.entries(pack.clocks)) {
      if (!clockNames.has(name)) continue;
      for (const c of getClocks(doc, name)) {
        clocks.push({
          name,
          label: def.label || name,
          field: c.field,
          start: c.start,
          end: c.end,
          text: c.text,
          event_at: isoOrNull(c.eventMs),
          elapsed_minutes_at_item_time: c.elapsedMinutes === null ? null : Math.round(c.elapsedMinutes),
          windows: (def.windows || []).map((w) => ({
            label: w.label,
            minutes: w.minutes,
            deadline: c.eventMs === null ? null : isoOrNull(c.eventMs + w.minutes * 60000),
            remaining_minutes_at_item_time: c.elapsedMinutes === null ? null : Math.round(w.minutes - c.elapsedMinutes),
          })),
        });
      }
    }
    clocks.sort((a, b) => a.field.localeCompare(b.field) || a.start - b.start);
  }

  const tierDef = tierById(pack, tier);
  const sla = tierDef.sla_minutes && createdMs !== null ? { minutes: tierDef.sla_minutes, deadline: isoOrNull(createdMs + tierDef.sla_minutes * 60000) } : null;
  const deadlines = [];
  if (sla) deadlines.push(parseTime(sla.deadline));
  for (const c of clocks) for (const w of c.windows) if (w.deadline && w.remaining_minutes_at_item_time > 0) deadlines.push(parseTime(w.deadline));
  const deadlineMs = deadlines.length ? Math.min(...deadlines) : null;

  const reviewReasons = [];
  if (tier === pack._baseline) reviewReasons.push('no rule matched');
  else if (tier !== pack._top) reviewReasons.push(`flagged ${tier}, below the top tier ${pack._top}: check whether a top-tier rule applies`);
  const suppressed = dedupeSuppressed(doc.suppressed);
  if (suppressed.length) reviewReasons.push('a rule term appeared negated or historical');
  if (rules.some((r) => r.evidence.every((e) => e.fuzzy))) reviewReasons.push('matched only through a spelling-tolerant match');
  if (floor.unknown !== null) reviewReasons.push(`priority "${floor.unknown}" is not in the pack's floor map, so it set no floor: check it by hand`);

  return {
    id: item.id,
    title: item.title,
    url: item.url,
    original_index: index,
    created_at: item.created_at,
    priority: item.priority,
    labels: item.labels,
    location: item.location,
    tier,
    tier_name: tierDef.name,
    floor: floor.unknown === null ? { tier: floor.tier, reasons: floor.reasons } : { tier: floor.tier, reasons: floor.reasons, unknown_priority: floor.unknown },
    raised: tierRank(pack, tier) < tierRank(pack, floor.tier),
    rules,
    annotations: [],
    clocks,
    sla,
    deadline: isoOrNull(deadlineMs),
    suppressed,
    rules_without_quote: silent,
    review_reasons: reviewReasons,
    explanation: explain(pack, tier, floor, rules),
    ...(masks && masks.length ? { masked: [...masks].sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : a.start - b.start)) } : {}),
    _error: floor.error,
  };
}

/** What made a result its tier, for a pull request that inherits it: its top-tier rules, else its floor. */
function tierReasons(r) {
  const rules = r.rules.filter((x) => x.tier === r.tier && !x.linked).map((x) => x.id);
  if (rules.length) return rules;
  return r.floor.reasons.filter((x) => x.tier === r.tier).map((x) => `${x.kind} "${x.evidence[0].text}"`);
}

/**
 * The text a link pattern reads, same offsets: HTML comments blanked (template guidance such as
 * "<!-- Fixes #123 -->"), but not template or boilerplate masks. "Fixes #101" and "Fixes #202" normalise to
 * the same line, so in a repository where most pull requests link an issue, boilerplate masking would hide every
 * link; a link only counts when it names an item in the run anyway.
 */
function scanField(item, name) {
  const text = fieldValue(item, name);
  if (typeof text !== 'string' || !text) return null;
  return name === 'title' ? text : maskTemplateText(text);
}

function numberOf(item) {
  if (item.metadata && Number.isInteger(item.metadata.number)) return item.metadata.number;
  const m = /^#(\d+)$/.exec(item.id);
  return m ? Number(m[1]) : null;
}

/**
 * Pull requests inherit the tier of the issues they fix. A pull request (pack.inherit.when) whose text says
 * "Fixes #N" (pack.inherit.regex, first capture group the number) gets a rule entry at the tier issue #N had
 * from its own rules and floor (never from another link, so links do not chain). Issue #N must be in the run
 * or in `linked` (issues fetched only to resolve links; never on the board). Raise-only, like every rule.
 */
function linkPass(pack, items, results, masksById, linkedResults) {
  const cfg = pack.inherit;
  if (!cfg) return 0;
  const byNumber = new Map();
  for (const { item, result } of linkedResults) {
    const n = numberOf(item);
    if (n !== null) byNumber.set(n, result);
  }
  items.forEach((it, i) => {
    const n = numberOf(it);
    if (n !== null) byNumber.set(n, results[i]);
  });
  const re = new RegExp(cfg.regex, 'giu');
  let linkedCount = 0;
  items.forEach((item, i) => {
    const masks = masksById.get(item.id) || null;
    if (cfg.when) {
      const doc = prepareItem(item, pack, masks);
      if (!evaluate(cfg.when, doc, cfg.id).ok) return;
    }
    const own = numberOf(item);
    const found = [];
    for (const name of ['title', ...Object.keys(item.text)]) {
      const scan = scanField(item, name);
      if (!scan) continue;
      for (const m of scan.matchAll(re)) {
        const n = Number(m[1]);
        if (!Number.isInteger(n) || n === own) continue;
        const target = byNumber.get(n);
        if (!target || target.tier === pack._baseline) continue;
        const text = fieldValue(item, name).slice(m.index, m.index + m[0].length);
        found.push({ target, evidence: { field: name, start: m.index, end: m.index + m[0].length, text, context: 'affirmed' } });
      }
    }
    if (!found.length) return;
    const best = found.reduce((acc, f) => (tierRank(pack, f.target.tier) < tierRank(pack, acc) ? f.target.tier : acc), pack._baseline);
    const use = found.filter((f) => f.target.tier === best);
    const linked = [];
    for (const f of use) if (!linked.some((l) => l.id === f.target.id)) linked.push({ id: f.target.id, tier: f.target.tier, title: f.target.title, by: tierReasons(f.target) });
    const inherited = {
      id: cfg.id,
      tier: best,
      title: cfg.title,
      why: cfg.why,
      category: cfg.category || null,
      source: cfg.source,
      evidence: sortEvidence(use.map((f) => f.evidence)),
      linked,
    };
    results[i] = evaluateItem(item, pack, i, { masks, inherited });
    linkedCount++;
  });
  return linkedCount;
}

/** For boilerplate masking: does a top-tier rule match this line on its own, read as that field of that item? */
function topTierCheck(pack) {
  return (line, field, item) => {
    const probe = { ...item, id: `${item.id}:mask-check`, title: '', text: { [field]: line }, priority: null, labels: [] };
    const doc = prepareItem(probe, pack);
    return pack.rules.some((rule) => {
      if (rule.tier !== pack._top) return false;
      const r = evaluate(rule.match, doc, rule.id);
      return r.ok && r.evidence.length > 0;
    });
  };
}

function collectClockNames(cond, out) {
  if (cond.clock) out.add(cond.clock);
  for (const k of ['any', 'all', 'none']) if (Array.isArray(cond[k])) cond[k].forEach((c) => collectClockNames(c, out));
}

function dedupeSuppressed(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const k = `${s.rule}:${s.field}:${s.start}:${s.end}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ rule: s.rule, field: s.field, start: s.start, end: s.end, text: s.text, context: s.context });
  }
  return out.sort((a, b) => a.rule.localeCompare(b.rule) || a.field.localeCompare(b.field) || a.start - b.start);
}

export function explain(pack, tier, floor, rules, annotations = []) {
  const parts = [];
  const floorBits = floor.reasons.map((r) => `${r.kind} "${r.evidence[0].text}" sets a floor of ${r.tier}`);
  if (rules.length) {
    const top = rules.filter((r) => r.tier === tier);
    const use = top.length ? top : rules;
    parts.push(
      use.map((r) => `${r.id} (${r.tier}) quotes "${r.evidence[0].text}"${r.evidence.length > 1 ? ` and ${r.evidence.length - 1} more` : ''}`).join('; '),
    );
  }
  const link = rules.find((r) => r.linked && r.tier === tier);
  if (link) parts.push(`${link.linked.map((l) => `${l.id} is ${l.tier} by ${l.by.join(', ') || 'its floor'}`).join('; ')}`);
  for (const a of annotations) parts.push(`annotation ${a.rule_id} (${a.raise_to}) quotes "${a.quotes[0]}"`);
  if (floorBits.length) parts.push(floorBits.join('; '));
  if (!parts.length) return 'No rule matched. This does not mean the item is not urgent.';
  return `${tier}: ${parts.join('. ')}.`;
}

/** Order evaluated items for the board. */
export function orderResults(pack, results) {
  const key = (r) => {
    const deadline = r.deadline ? parseTime(r.deadline) : Infinity;
    const created = r.created_at ? parseTime(r.created_at) ?? Infinity : Infinity;
    return [tierRank(pack, r.tier), deadline, created, r.original_index];
  };
  const flagged = results.filter((r) => r.tier !== pack._baseline);
  const rest = results.filter((r) => r.tier === pack._baseline).sort((a, b) => a.original_index - b.original_index);
  flagged.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
  const ordered = [...flagged, ...rest];
  ordered.forEach((r, i) => {
    r.position = i + 1;
  });
  return ordered;
}

export function counts(pack, ordered) {
  const byTier = {};
  for (const t of pack.tiers) byTier[t.id] = 0;
  for (const r of ordered) byTier[r.tier]++;
  const flagged = ordered.filter((r) => r.tier !== pack._baseline).length;
  return { total: ordered.length, flagged, unmatched: ordered.length - flagged, by_tier: byTier };
}

/**
 * Run the engine over items.
 * @param {object[]} items normalised items
 * @param {object} pack compiled pack
 * @param {{now?: string}} opts `now` is recorded and used only for display (wait times, time left)
 */
export function triage(items, pack, { now = null, inputLabel = null, templates = null, linked = null } = {}) {
  if (pack.mode === 'research') {
    const notSynthetic = items.filter((it) => !it.synthetic).map((it) => it.id);
    if (notSynthetic.length) {
      throw new UserError(
        `Pack "${pack.name}" runs in research mode and accepts synthetic data only. ${notSynthetic.length} item(s) are not marked synthetic (set "synthetic": true, FHIR meta.security HTEST, or HL7 MSH-11 = T).`,
        { details: notSynthetic.slice(0, 20).map((id) => `not marked synthetic: ${id}`), code: 2 },
      );
    }
  }
  const check = topTierCheck(pack);
  const { masks, summary } = computeMasks(items, pack, { templates, topTierCheck: check });
  const results = items.map((it, i) => evaluateItem(it, pack, i, { masks: masks.get(it.id) || null }));
  let linkedResults = [];
  if (pack.inherit && linked && linked.length) {
    const ids = new Set(items.map((it) => it.id));
    const extra = linked.filter((it) => !ids.has(it.id));
    const lm = computeMasks(extra, pack, { templates, topTierCheck: check }).masks;
    linkedResults = extra.map((it, i) => ({ item: it, result: evaluateItem(it, pack, i, { masks: lm.get(it.id) || null }) }));
  }
  const inheritedCount = linkPass(pack, items, results, masks, linkedResults);
  const errors = results.filter((r) => r._error).map((r) => `${r.id}: ${r._error}`);
  if (errors.length) throw new UserError(`Input failed validation for pack "${pack.name}" (${errors.length} item(s))`, { details: errors, code: 2 });
  results.forEach((r) => delete r._error);
  const ordered = orderResults(pack, results);
  return {
    engine: { name: 'urgent-first', version: VERSION },
    pack: { name: pack.name, version: pack.version, title: pack.title, mode: pack.mode, ...(pack.mode === 'research' ? { banner: pack.banner } : {}), tiers: pack.tiers.map((t) => ({ id: t.id, name: t.name, sla_minutes: t.sla_minutes ?? null })) },
    input: inputLabel,
    now: now,
    counts: counts(pack, ordered),
    ...(summary ? { masking: summary } : {}),
    ...(pack.inherit ? { links: { pull_requests_inheriting: inheritedCount, linked_items_fetched: linkedResults.length } } : {}),
    items: ordered,
    annotations: null,
  };
}
