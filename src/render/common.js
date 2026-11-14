// Shared helpers for the Markdown and HTML boards.
import { formatMinutes, parseTime } from '../util.js';

export const NO_RULE_HEADING = 'No rule matched';
export const NO_RULE_NOTE = 'This does not mean not urgent. Items are listed in their original order.';
export const FOOTER_NOTE = 'Every flag quotes the exact words that matched. No item is placed below the tier its own priority field implies; rules and annotations can only raise.';

export function waitText(r, nowMs) {
  const created = parseTime(r.created_at);
  if (created === null || nowMs === null) return null;
  return formatMinutes((nowMs - created) / 60000);
}

function hhmm(iso, ref) {
  // Show the wall-clock time in the same UTC offset as the reference string.
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(String(ref || ''));
  const off = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  const d = new Date(parseTime(iso) + off * 60000);
  const day = d.toISOString().slice(0, 10);
  return { time: d.toISOString().slice(11, 16), day };
}

/** One line per clock window, e.g. "Last known well 07:40 (LKW 0740): IV thrombolysis 4 h 30 min window closes 12:10, 3 h left at order time". */
export function clockLines(r, nowMs) {
  const out = [];
  for (const c of r.clocks) {
    const head = `${c.label}${c.event_at ? ` ${hhmm(c.event_at, r.created_at).time}` : ''}`;
    if (!c.windows.length) {
      out.push(`${head} (quoted: "${c.text}")${c.elapsed_minutes_at_item_time !== null ? `, ${formatMinutes(c.elapsed_minutes_at_item_time)} before the item time` : ''}`);
      continue;
    }
    const parts = c.windows.map((w) => {
      if (!w.deadline) return `${w.label} (${formatMinutes(w.minutes)})`;
      const close = hhmm(w.deadline, r.created_at);
      const rem = w.remaining_minutes_at_item_time;
      const atOrder = rem > 0 ? `${formatMinutes(rem)} left at item time` : `already passed at item time`;
      let atNow = '';
      if (nowMs !== null && rem > 0) {
        const left = (parseTime(w.deadline) - nowMs) / 60000;
        atNow = left > 0 ? `, ${formatMinutes(left)} left now` : ', passed now';
      }
      return `${w.label} (${formatMinutes(w.minutes)}) closes ${close.time}${close.day !== hhmm(r.created_at, r.created_at).day ? ` on ${close.day}` : ''}: ${atOrder}${atNow}`;
    });
    out.push(`${head} (quoted: "${c.text}"): ${parts.join('; ')}`);
  }
  return out;
}

export function slaText(r, nowMs) {
  if (!r.sla) return null;
  const due = parseTime(r.sla.deadline);
  let state = '';
  if (nowMs !== null) {
    const left = (due - nowMs) / 60000;
    state = left >= 0 ? `, ${formatMinutes(left)} left` : `, overdue by ${formatMinutes(-left)}`;
  }
  return `target ${formatMinutes(r.sla.minutes)} (pack setting)${state}`;
}

export function floorText(r) {
  return r.floor.reasons.map((x) => `${x.kind} "${x.evidence[0].text}" sets ${x.tier}`).join('; ');
}

/** All evidence spans of an item grouped by field: rules, annotations, clocks and floor. */
export function evidenceByField(r) {
  const by = new Map();
  const add = (e, tag) => {
    if (!by.has(e.field)) by.set(e.field, []);
    by.get(e.field).push({ ...e, tag });
  };
  for (const rule of r.rules) for (const e of rule.evidence) add(e, rule.id);
  for (const a of r.annotations) for (const e of a.evidence) add(e, a.rule_id === 'LLM' ? 'LLM' : `${a.rule_id} (annotation)`);
  for (const c of r.clocks) add({ field: c.field, start: c.start, end: c.end, text: c.text }, `clock:${c.name}`);
  for (const f of r.floor.reasons) for (const e of f.evidence) add(e, `floor:${f.kind}`);
  return by;
}

/** Merge overlapping spans: [{start, end, tags:Set, quotes:Set}] sorted by start. */
export function unionSpans(spans) {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      last.end = Math.max(last.end, s.end);
      last.tags.add(s.tag);
      last.quotes.add(s.text);
    } else out.push({ start: s.start, end: s.end, tags: new Set([s.tag]), quotes: new Set([s.text]) });
  }
  return out;
}

/** "2026-11-14T09:00:00.000Z" -> "2026-11-14 09:00 UTC". */
export function displayTime(iso) {
  const ms = parseTime(iso);
  if (ms === null) return '';
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/** Evidence with repeated quote texts removed (the first occurrence is kept). */
export function uniqueQuotes(evidence) {
  const seen = new Set();
  return evidence.filter((e) => (seen.has(e.text) ? false : seen.add(e.text)));
}

/** Split an item's rules into those at its own tier and lower-tier extras. */
export function splitRules(r, tierOrder) {
  const rank = (t) => tierOrder.indexOf(t);
  const main = r.rules.filter((x) => rank(x.tier) <= rank(r.tier));
  const extra = r.rules.filter((x) => rank(x.tier) > rank(r.tier));
  return { main, extra };
}

export const MASKED_NOTE = 'template text, not read by rules';

/** One line about what the rules did not read, for the board header; null when nothing was masked. */
export function maskingSummary(result) {
  const m = result.masking;
  if (!m || (!m.template_lines_masked && !m.boilerplate_lines_masked)) return null;
  const parts = [];
  if (m.template_lines_masked) parts.push(`${m.template_lines_masked} line(s) from the repository's issue and pull request templates`);
  if (m.boilerplate_lines_masked) parts.push(`${m.boilerplate_lines_masked} line(s) repeated in at least ${Math.round(m.boilerplate.min_share * 100)}% of items of the same kind`);
  return `Masked in ${m.items_masked} item(s): ${parts.join(' and ')}. Shown dimmed as ${MASKED_NOTE}.`;
}

/** Masked ranges of one field, merged and sorted. */
export function maskedRanges(r, field) {
  const ranges = (r.masked || []).filter((m) => m.field === field).sort((a, b) => a.start - b.start);
  const out = [];
  for (const m of ranges) {
    const last = out[out.length - 1];
    if (last && m.start <= last.end) last.end = Math.max(last.end, m.end);
    else out.push({ start: m.start, end: m.end });
  }
  return out;
}
