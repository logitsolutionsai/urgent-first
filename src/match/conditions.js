// Evaluate a rule's match tree against one item.
//
// Condition forms (see references/rule-matching.md):
//   {"any": [...]}, {"all": [...]}, {"none": [...]}
//   {"terms": ["data loss", "dissect*", "worst headache of * life"], "fields"?: [...], "include"?: [...], "typos"?: bool,
//    "except"?: ["neck dissection"]}   (a hit lying inside an "except" phrase does not count)
//   {"near": [["lost", "deleted"], ["projects", "files"]], "within": 6, "fields"?, "include"?, "typos"?}
//   {"regex": "pattern", "flags"?: "i", "fields"?, "include"?}
//   {"number": "spo2", "op": "<", "value": 92}
//   {"clock": "lkw", "within_minutes"?: 1440}
//   {"field": "location", "in": ["ED"]} | {"field": "labels", "matches": ["security"]} | {"field": "metadata.reactions", "op": ">=", "value": 10} | {"field": "...", "equals": true}
//   {"mentions": "metadata.latest_release_aliases", "fields"?, "include"?}
//
// Every condition returns { ok, evidence: [{field,start,end,text,context,fuzzy?}] }.
// "include" lists which mention contexts count: affirmed, suspected, historical, negated.
// Default ["affirmed", "suspected"]: negated and historical mentions do not count; suspected ones do.

import { tokenize, findTerm, compileTerm, maskTemplateText } from './text.js';
import { computeContext, classifyRange } from './context.js';
import { extractNumbers, extractClocks } from './extract.js';
import { textFieldNames, fieldValue } from '../items.js';
import { parseTime } from '../util.js';
import { applyMask } from '../mask.js';

const DEFAULT_INCLUDE = ['affirmed', 'suspected'];

/**
 * Per-item cache of tokens and context, built lazily per field.
 * `masks` ([{field, start, end, kind}], from src/mask.js) are blanked in the text the rules read.
 */
export function prepareItem(item, pack, masks = null) {
  const itemMs = parseTime(item.created_at);
  const itemYear = itemMs === null ? null : new Date(itemMs).getUTCFullYear();
  const cache = new Map();
  return {
    item,
    itemMs,
    pack,
    defaultFields: pack.fields && pack.fields.length ? pack.fields : textFieldNames(item),
    field(name) {
      if (cache.has(name)) return cache.get(name);
      const text = fieldValue(item, name);
      let entry = null;
      if (typeof text === 'string' && text.length) {
        // `scan` is what rules read (HTML comments in text fields blanked, same length); `text` is what they quote.
        const own = Object.prototype.hasOwnProperty.call(item.text, name);
        let scan = own ? maskTemplateText(text) : text;
        if (own && masks && masks.length) scan = applyMask(scan, masks.filter((m) => m.field === name));
        const tokens = tokenize(scan, pack._abbrevs);
        const ctx = computeContext(tokens, pack._cues, { window: pack.matching.window, itemYear });
        entry = { name, text, scan, tokens, ctx };
      }
      cache.set(name, entry);
      return entry;
    },
    numbers: new Map(),
    clocks: new Map(),
    suppressed: [],
  };
}

function expandFields(names, item) {
  const out = [];
  for (const n of names) {
    if (n === 'text') {
      for (const k of Object.keys(item.text)) out.push(k);
    } else out.push(n);
  }
  return [...new Set(out)];
}

function resolveFields(cond, doc) {
  return expandFields(cond.fields && cond.fields.length ? cond.fields : doc.defaultFields, doc.item);
}

/**
 * Token ranges of the condition's "except" phrases in one field (look-alikes such as "stroke volume"),
 * indexed by start token so a lookup costs the length of the longest phrase, not the number of ranges.
 */
function exceptRanges(cond, entry, doc, opts) {
  if (!cond.except || !cond.except.length) return null;
  const pats = compiled(cond, '_except', () => cond.except.map((t) => compileTerm(t, doc.pack._abbrevs)));
  const byStart = new Map();
  let maxLen = 0;
  for (const r of pats.flatMap((p) => findTerm(p, entry.tokens, { ...opts, typos: false }))) {
    byStart.set(r.a, Math.max(byStart.get(r.a) ?? -1, r.b));
    maxLen = Math.max(maxLen, r.b - r.a);
  }
  return byStart.size ? { byStart, maxLen } : null;
}

function insideExcept(ranges, a, b) {
  if (!ranges) return false;
  for (let s = a; s >= 0 && s >= a - ranges.maxLen; s--) if ((ranges.byStart.get(s) ?? -1) >= b) return true;
  return false;
}

/** Indexes [a, b] of the tokens overlapping the text range [s, e), or [-1, -1]. Token offsets never decrease. */
function tokenRange(tokens, s, e) {
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid].e > s) hi = mid;
    else lo = mid + 1;
  }
  if (lo >= tokens.length || tokens[lo].s >= e) return [-1, -1];
  let b = lo;
  while (b + 1 < tokens.length && tokens[b + 1].s < e) b++;
  return [lo, b];
}

/** First index i in a non-decreasing array (or sorted list via key) with value >= x. */
function lowerBound(arr, x, key = (v) => v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Prefix counts per field for near(): words before token k, and sentence/soft boundaries before token k. */
function nearIndex(entry) {
  if (!entry._near) {
    const n = entry.tokens.length;
    const W = new Int32Array(n + 1);
    const BC = new Int32Array(n + 1);
    for (let k = 0; k < n; k++) {
      const t = entry.tokens[k].k;
      W[k + 1] = W[k] + (t === 'w' ? 1 : 0);
      BC[k + 1] = BC[k] + (t === 'b' || t === 'c' ? 1 : 0);
    }
    entry._near = { W, BC };
  }
  return entry._near;
}

function span(entry, a, b, context, fuzzy) {
  // A suspected mention quotes its cue too when the cue sits right before it: "r/o PE", "?SAH".
  let cued = false;
  if (context === 'suspected' && a > 0) {
    const ci = entry.ctx.cueAt[a - 1];
    const cue = ci >= 0 ? entry.ctx.cues[ci] : null;
    if (cue && (cue.kind === 'susp' || cue.kind === 'q') && cue.dir !== 'post') {
      a = cue.a;
      cued = true;
    }
  }
  const s = entry.tokens[a].s;
  const e = entry.tokens[b].e;
  const ev = { field: entry.name, start: s, end: e, text: entry.text.slice(s, e), context };
  if (fuzzy) ev.fuzzy = true;
  // Not serialised: lets the engine show "r/o PE" first without promoting a word that merely sits before a "?".
  if (cued) Object.defineProperty(ev, 'cued', { value: true, enumerable: false });
  return ev;
}

function compiled(cond, key, build) {
  if (!cond[key]) Object.defineProperty(cond, key, { value: build(), enumerable: false });
  return cond[key];
}

function evalTerms(cond, doc, ruleId) {
  const pack = doc.pack;
  const patterns = compiled(cond, '_patterns', () => cond.terms.map((t) => compileTerm(t, pack._abbrevs)));
  const include = cond.include || DEFAULT_INCLUDE;
  const opts = { typos: cond.typos ?? pack.matching.typos, typoMinLength: pack.matching.typo_min_length };
  const evidence = [];
  for (const fname of resolveFields(cond, doc)) {
    const entry = doc.field(fname);
    if (!entry) continue;
    const except = exceptRanges(cond, entry, doc, opts);
    patterns.forEach((pat) => {
      for (const hit of findTerm(pat, entry.tokens, opts)) {
        if (insideExcept(except, hit.a, hit.b)) continue;
        const context = classifyRange(entry.ctx, hit.a, hit.b, entry.tokens);
        const ev = span(entry, hit.a, hit.b, context, hit.fuzzy);
        if (include.includes(context)) evidence.push(ev);
        else doc.suppressed.push({ rule: ruleId, ...ev });
      }
    });
  }
  return dedupe(evidence);
}

function evalNear(cond, doc, ruleId) {
  const pack = doc.pack;
  const groups = compiled(cond, '_groups', () => cond.near.map((g) => g.map((t) => compileTerm(t, pack._abbrevs))));
  const include = cond.include || DEFAULT_INCLUDE;
  const within = cond.within ?? 6;
  const opts = { typos: cond.typos ?? pack.matching.typos, typoMinLength: pack.matching.typo_min_length };
  const evidence = [];
  for (const fname of resolveFields(cond, doc)) {
    const entry = doc.field(fname);
    if (!entry) continue;
    const except = exceptRanges(cond, entry, doc, opts);
    const hitsPerGroup = groups.map((g) => g.flatMap((pat) => findTerm(pat, entry.tokens, opts)).filter((h) => !insideExcept(except, h.a, h.b)));
    if (hitsPerGroup.some((h) => !h.length)) continue;
    // Pair every hit of group 0 with the nearest hits of the other groups in the same sentence: no sentence
    // or soft boundary between them and at most `within` words strictly between. Candidates are found by
    // binary search over prefix word counts, so a long pasted log costs O(hits log hits), not O(hits² × length).
    const { W, BC } = nearIndex(entry);
    const sorted = hitsPerGroup.map((hits) => {
      const withIdx = hits.map((h, idx) => ({ h, idx }));
      return {
        byA: [...withIdx].sort((x, y) => x.h.a - y.h.a || x.idx - y.idx),
        byB: [...withIdx].sort((x, y) => x.h.b - y.h.b || x.idx - y.idx),
      };
    });
    const n = entry.tokens.length;
    for (const h0 of hitsPerGroup[0]) {
      let a = h0.a;
      let b = h0.b;
      let fuzzy = h0.fuzzy;
      let ok = true;
      const picked = [h0];
      for (let gi = 1; gi < hitsPerGroup.length; gi++) {
        let best = null;
        const consider = ({ h, idx }, words, crosses) => {
          if (crosses || words > within) return;
          if (!best || words < best.words || (words === best.words && idx < best.idx)) best = { h, words, idx };
        };
        // Hits after the current span: h.a > b and W[h.a] - W[b + 1] <= within.
        const maxA = Math.min(n - 1, lowerBound(W, W[b + 1] + within + 1) - 1);
        const { byA, byB } = sorted[gi];
        for (let i = lowerBound(byA, b + 1, (x) => x.h.a); i < byA.length && byA[i].h.a <= maxA; i++) {
          const h = byA[i].h;
          consider(byA[i], W[h.a] - W[b + 1], BC[h.b + 1] - BC[a] > 0);
        }
        // Hits before the current span: h.b < a and W[a] - W[h.b + 1] <= within.
        const minB = Math.max(0, lowerBound(W, W[a] - within) - 1);
        for (let i = lowerBound(byB, minB, (x) => x.h.b); i < byB.length && byB[i].h.b < a; i++) {
          const h = byB[i].h;
          consider(byB[i], W[a] - W[h.b + 1], BC[b + 1] - BC[h.a] > 0);
        }
        if (!best) {
          ok = false;
          break;
        }
        picked.push(best.h);
        a = Math.min(a, best.h.a);
        b = Math.max(b, best.h.b);
        fuzzy = fuzzy || best.h.fuzzy;
      }
      if (!ok) continue;
      // Each part is judged on its own: one suspected part makes the pair suspected; otherwise a
      // negated or historical part takes the pair out of play ("startup (no crash" does not count).
      const parts = picked.map((h) => classifyRange(entry.ctx, h.a, h.b, entry.tokens));
      const context = parts.includes('suspected') ? 'suspected' : parts.find((p) => p !== 'affirmed') || 'affirmed';
      const ev = span(entry, a, b, context, fuzzy);
      if (include.includes(context)) evidence.push(ev);
      else doc.suppressed.push({ rule: ruleId, ...ev });
    }
  }
  return dedupe(evidence);
}

function evalRegex(cond, doc, ruleId) {
  const re = compiled(cond, '_re', () => {
    const flags = cond.flags ?? 'i';
    return new RegExp(cond.regex, (flags.includes('g') ? flags : flags + 'g') + (flags.includes('u') ? '' : 'u'));
  });
  const include = cond.include || DEFAULT_INCLUDE;
  const evidence = [];
  for (const fname of resolveFields(cond, doc)) {
    const entry = doc.field(fname);
    if (!entry) continue;
    re.lastIndex = 0;
    for (const m of entry.scan.matchAll(re)) {
      if (!m[0].length) continue;
      const s = m.index;
      const e = s + m[0].length;
      const [a, b] = tokenRange(entry.tokens, s, e);
      const context = a < 0 ? 'affirmed' : classifyRange(entry.ctx, a, b, entry.tokens);
      const ev = { field: fname, start: s, end: e, text: entry.text.slice(s, e), context };
      if (include.includes(context)) evidence.push(ev);
      else doc.suppressed.push({ rule: ruleId, ...ev });
    }
  }
  return dedupe(evidence);
}

function fieldTexts(doc, fields) {
  return expandFields(fields, doc.item).map((f) => doc.field(f)).filter(Boolean).map((e) => ({ field: e.name, text: e.scan }));
}

/** Extractors read the masked text; their quotes are re-cut from the item's own text. */
function quoteFromItem(doc, found) {
  for (const v of found) v.text = doc.field(v.field).text.slice(v.start, v.end);
  return found;
}

export function getNumbers(doc, name) {
  if (!doc.numbers.has(name)) {
    const def = doc.pack.numbers[name];
    const fields = def.fields && def.fields.length ? def.fields : textFieldNames(doc.item);
    doc.numbers.set(name, quoteFromItem(doc, extractNumbers(def, fieldTexts(doc, fields))));
  }
  return doc.numbers.get(name);
}

export function getClocks(doc, name) {
  if (!doc.clocks.has(name)) {
    const def = doc.pack.clocks[name];
    const fields = def.fields && def.fields.length ? def.fields : textFieldNames(doc.item);
    doc.clocks.set(name, quoteFromItem(doc, extractClocks(def, fieldTexts(doc, fields), doc.itemMs, doc.item.created_at)));
  }
  return doc.clocks.get(name);
}

function compare(a, op, b) {
  switch (op) {
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    case '==': return a === b;
    case '!=': return a !== b;
    default: return false;
  }
}

function evalNumber(cond, doc) {
  const values = getNumbers(doc, cond.number);
  return values.filter((v) => compare(v.value, cond.op, cond.value)).map((v) => ({ field: v.field, start: v.start, end: v.end, text: v.text, context: 'affirmed', value: v.value }));
}

function evalClock(cond, doc) {
  const clocks = getClocks(doc, cond.clock);
  return clocks
    .filter((c) => cond.within_minutes === undefined || (c.elapsedMinutes !== null && c.elapsedMinutes <= cond.within_minutes))
    .map((c) => ({ field: c.field, start: c.start, end: c.end, text: c.text, context: 'affirmed', clock: cond.clock }));
}

function evalField(cond, doc) {
  const item = doc.item;
  const path = cond.field;
  if (path === 'labels') {
    const evidence = [];
    item.labels.forEach((label, i) => {
      const l = label.toLowerCase();
      const hit =
        (cond.in && cond.in.some((v) => String(v).toLowerCase() === l)) ||
        (cond.matches && cond.matches.some((p) => labelMatches(l, p)));
      if (hit) evidence.push({ field: `labels[${i}]`, start: 0, end: label.length, text: label, context: 'affirmed' });
    });
    return { ok: evidence.length > 0, evidence };
  }
  let value;
  if (path === 'location' || path === 'priority' || path === 'title' || path === 'source') value = item[path];
  else if (path.startsWith('metadata.')) value = item.metadata[path.slice(9)];
  else return { ok: false, evidence: [] };
  let ok = false;
  if (cond.in) ok = value !== null && value !== undefined && cond.in.some((v) => String(v).toLowerCase() === String(value).toLowerCase());
  else if ('equals' in cond) ok = value === cond.equals || (typeof value === 'string' && typeof cond.equals === 'string' && value.toLowerCase() === cond.equals.toLowerCase());
  else if (cond.op) ok = typeof value === 'number' && compare(value, cond.op, cond.value);
  else if (cond.matches) ok = typeof value === 'string' && cond.matches.some((p) => labelMatches(value.toLowerCase(), p));
  // Only fields shown on the board are quoted. Metadata and source are filters: "pull_request" is the
  // adapter's type, not words of the item, so it never becomes a quote.
  const evidence = ok && QUOTED_FIELDS.has(path) && typeof value === 'string' && value.length ? [{ field: path, start: 0, end: value.length, text: value, context: 'affirmed' }] : [];
  return { ok, evidence };
}

/** Field paths whose value a field condition quotes (labels are quoted per label). */
export const QUOTED_FIELDS = new Set(['title', 'location', 'priority']);

/** Word-boundary match of a label pattern inside a label ("security" matches "type: security"). */
export function labelMatches(labelLower, pattern) {
  const p = String(pattern).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${p}([^a-z0-9]|$)`).test(labelLower);
}

function versionBounded(text, idx, len) {
  const before = text[idx - 1];
  const after = text[idx + len];
  const after2 = text[idx + len + 1];
  if (before && /[\p{L}\p{N}._-]/u.test(before) && !(before === 'v' || before === 'V')) return false;
  if (before && (before === 'v' || before === 'V') && /[\p{L}\p{N}]/u.test(text[idx - 2] || '')) return false;
  if (after && /[\p{L}\p{N}]/u.test(after)) return false;
  if (after === '.' && after2 && /\d/.test(after2)) return false;
  return true;
}

function evalMentions(cond, doc, ruleId) {
  const key = cond.mentions.replace(/^metadata\./, '');
  let values = doc.item.metadata[key];
  if (typeof values === 'string') values = [values];
  if (!Array.isArray(values) || !values.length) return [];
  const include = cond.include || DEFAULT_INCLUDE;
  const evidence = [];
  const sorted = [...values].map(String).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const fname of resolveFields(cond, doc)) {
    const entry = doc.field(fname);
    if (!entry) continue;
    const taken = new Uint8Array(entry.scan.length);
    for (const v of sorted) {
      let from = 0;
      for (;;) {
        const idx = entry.scan.indexOf(v, from);
        if (idx < 0) break;
        from = idx + 1;
        if (!versionBounded(entry.scan, idx, v.length)) continue;
        if (taken.subarray(idx, idx + v.length).includes(1)) continue;
        taken.fill(1, idx, idx + v.length);
        const [a, b] = tokenRange(entry.tokens, idx, idx + v.length);
        const context = a < 0 ? 'affirmed' : classifyRange(entry.ctx, a, b, entry.tokens);
        const ev = { field: fname, start: idx, end: idx + v.length, text: v, context };
        if (include.includes(context)) evidence.push(ev);
        else doc.suppressed.push({ rule: ruleId, ...ev });
      }
    }
  }
  return evidence;
}

function dedupe(evidence) {
  const seen = new Set();
  return evidence.filter((e) => {
    const k = `${e.field}:${e.start}:${e.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Evaluate a condition tree. */
export function evaluate(cond, doc, ruleId) {
  if (cond.any) {
    let ok = false;
    const evidence = [];
    for (const c of cond.any) {
      const r = evaluate(c, doc, ruleId);
      if (r.ok) {
        ok = true;
        evidence.push(...r.evidence);
      }
    }
    return { ok, evidence: dedupe(evidence) };
  }
  if (cond.all) {
    const evidence = [];
    for (const c of cond.all) {
      const r = evaluate(c, doc, ruleId);
      if (!r.ok) return { ok: false, evidence: [] };
      evidence.push(...r.evidence);
    }
    return { ok: true, evidence: dedupe(evidence) };
  }
  if (cond.none) {
    for (const c of cond.none) {
      // Suppressed mentions inside a "none" branch are not interesting for review.
      const before = doc.suppressed.length;
      const r = evaluate(c, doc, ruleId);
      doc.suppressed.length = before;
      if (r.ok) return { ok: false, evidence: [] };
    }
    return { ok: true, evidence: [] };
  }
  let evidence;
  if (cond.terms) evidence = evalTerms(cond, doc, ruleId);
  else if (cond.near) evidence = evalNear(cond, doc, ruleId);
  else if (cond.regex) evidence = evalRegex(cond, doc, ruleId);
  else if (cond.number) evidence = evalNumber(cond, doc);
  else if (cond.clock) evidence = evalClock(cond, doc);
  else if (cond.field) return evalField(cond, doc);
  else if (cond.mentions) evidence = evalMentions(cond, doc, ruleId);
  else throw new Error(`Unknown condition: ${JSON.stringify(cond)}`);
  return { ok: evidence.length > 0, evidence };
}
