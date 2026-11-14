// Template and boilerplate masking.
//
// Real issue trackers are full of text nobody typed for this item: the repository's issue and pull request
// templates ("Final diff reviewed for security", "Does this issue occur when all extensions are disabled?")
// and text a tool pastes into every report (VS Code's system-information table, a bot's footer). Rules that
// read it flag items for words their reporters never wrote.
//
// Masking hides such lines from the rules and nothing else:
//  - template lines: a line equal to a line of the repository's issue or pull request templates (prompts,
//    headings, checklist lines, issue-form labels, descriptions and default values), or starting with one
//    (only the template part is masked, the reporter's answer after it stays readable);
//  - boilerplate lines: a line that appears, after normalisation, in at least `min_share` of the items of the
//    same source and type in this run, and in at least `min_items` of them.
// Masked text keeps its length and offsets (it is blanked with spaces in the copy the rules read), so every
// quote is still an exact substring, and the board shows it dimmed as "template text, not read by rules".
//
// Safeguards, each covered by a test:
//  - research-mode packs never mask;
//  - titles are never masked;
//  - a boilerplate line that a top-tier rule matches on its own is never masked (a crash or data-loss sentence
//    pasted into many reports is evidence, not boilerplate); repository template lines are the maintainers'
//    own words and are masked regardless;
//  - an issue-form dropdown option is not a template line: the option a reporter picked is their answer;
//  - a line that links another item ("Fixes #12", pack.inherit.regex) is never masked.
import { textFieldNames } from './items.js';

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
// Markdown decoration before a line's words: quote, list, heading and table markers, numbering, a checkbox.
const LEAD_RE = /^[\s>*+\-#|_`]*(?:\d+[.)]\s+)?(?:\[[ xX]\]\s*)?/;
const MAX_PREFIX_WORDS = 40;

export const DEFAULT_MASKING = Object.freeze({ templates: true, boilerplate: { min_share: 0.2, min_items: 5 } });

/** Words of one line with offsets relative to the line; digits generalised so versions and hashes compare equal. */
export function lineWords(line) {
  const lead = LEAD_RE.exec(line)[0].length;
  const out = [];
  WORD_RE.lastIndex = 0;
  for (const m of line.slice(lead).matchAll(WORD_RE)) {
    const w = m[0].toLowerCase().replace(/’/g, "'");
    out.push({ w: /\d/.test(w) ? '0' : w, s: lead + m.index, e: lead + m.index + m[0].length });
  }
  return out;
}

/** The normalised key of a line: its words, lower case, digits generalised, joined by single spaces. */
export function lineKey(line) {
  return lineWords(line)
    .map((x) => x.w)
    .join(' ');
}

function* lines(text) {
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    let contentEnd = end;
    if (contentEnd > start && text[contentEnd - 1] === '\r') contentEnd--;
    yield { start, end: contentEnd, line: text.slice(start, contentEnd) };
    if (end >= text.length) break;
    start = end + 1;
  }
}

function stripQuotes(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1).replace(/\\n/g, '\n');
  return t;
}

/**
 * The text lines of one template file. Markdown templates: every line except the front matter.
 * Issue forms (YAML): the values of label, description, placeholder and value keys (block scalars included)
 * and checkbox option labels. Dropdown options are skipped: the option a reporter picks is their answer.
 * A small line-based reader, not a YAML parser: it only needs the strings.
 */
export function templateFileLines(name, content) {
  const text = String(content || '').replace(/\r\n?/g, '\n');
  const out = [];
  if (/\.ya?ml$/i.test(name)) {
    const rows = text.split('\n');
    for (let i = 0; i < rows.length; i++) {
      const m = /^(\s*)(-\s+)?(label|description|placeholder|value):\s*(.*)$/.exec(rows[i]);
      if (!m) continue;
      const indent = m[1].length + (m[2] ? m[2].length : 0);
      const v = m[4].trim();
      if (/^[|>][-+0-9]*$/.test(v)) {
        for (let j = i + 1; j < rows.length; j++) {
          const row = rows[j];
          if (row.trim() === '') {
            out.push('');
            continue;
          }
          if (row.length - row.trimStart().length <= indent) break;
          out.push(row.trim());
          i = j;
        }
      } else if (v) out.push(...stripQuotes(v).split('\n'));
    }
  } else {
    let body = text;
    const fm = /^---\n[\s\S]*?\n---\n?/.exec(body);
    if (fm) body = body.slice(fm[0].length);
    out.push(...body.split('\n'));
  }
  return out.map((l) => l.replace(/<!--|-->/g, ' ')).filter((l) => lineKey(l) !== '');
}

/** A set of normalised template line keys from [{path, content}]. */
export function templateKeys(files) {
  const keys = new Set();
  for (const f of files || []) for (const l of templateFileLines(f.path || f.name || '', f.content)) keys.add(lineKey(l));
  return keys;
}

function maskConfig(pack) {
  if (pack.mode === 'research') return null;
  if (pack.masking === false || pack.masking === undefined || pack.masking === null) return null;
  const m = pack.masking === true ? {} : pack.masking;
  const b = m.boilerplate === false ? null : { ...DEFAULT_MASKING.boilerplate, ...(typeof m.boilerplate === 'object' ? m.boilerplate : {}) };
  return { templates: m.templates !== false, boilerplate: b };
}

/** Text fields that are masked: the pack's fields if it names any, else every text field; never the title. */
function maskableFields(item, pack) {
  const names = pack.fields && pack.fields.length ? pack.fields.filter((f) => Object.prototype.hasOwnProperty.call(item.text, f)) : textFieldNames(item).filter((f) => f !== 'title' && Object.prototype.hasOwnProperty.call(item.text, f));
  return [...new Set(names)].filter((f) => typeof item.text[f] === 'string');
}

function groupKey(item) {
  return `${item.source || ''}\u0000${(item.metadata && item.metadata.type) || ''}`;
}

/**
 * Compute masks for a batch of items.
 * @param {object[]} items normalised items
 * @param {object} pack compiled pack
 * @param {{templates?: Record<string, {path:string,content:string}[]>, topTierCheck?: (line:string, field:string, item:object)=>boolean}} opts
 *   templates: template files per item source ("github:owner/repo"); topTierCheck: true when a top-tier rule
 *   matches the line on its own, read as that field of that item (supplied by the engine).
 * @returns {{masks: Map<string, object[]>, summary: object|null}}
 */
export function computeMasks(items, pack, { templates = null, topTierCheck = null } = {}) {
  const cfg = maskConfig(pack);
  const masks = new Map();
  if (!cfg) return { masks, summary: null };
  // A line that links another item ("Fixes #12") is the item's own pointer and the quote of an inherited tier:
  // never masked, even when most pull requests carry one (it is never a rule word anyway).
  const linkRe = pack.inherit && pack.inherit.regex ? new RegExp(pack.inherit.regex, 'iu') : null;
  const keysBySource = new Map();
  if (cfg.templates && templates) for (const [src, files] of Object.entries(templates)) keysBySource.set(src, templateKeys(files));

  // Pass 1: split every maskable field into lines and count, per group, how many items contain each line.
  const groups = new Map();
  const perItem = [];
  for (const item of items) {
    const g = groupKey(item);
    if (!groups.has(g)) groups.set(g, { size: 0, counts: new Map(), sample: new Map() });
    const grp = groups.get(g);
    grp.size++;
    const seen = new Set();
    const fields = [];
    for (const field of maskableFields(item, pack)) {
      const ls = [];
      for (const l of lines(item.text[field])) {
        const words = lineWords(l.line);
        if (!words.length) continue;
        if (linkRe && linkRe.test(l.line)) continue;
        const key = words.map((x) => x.w).join(' ');
        ls.push({ ...l, words, key });
        if (!seen.has(key)) {
          seen.add(key);
          grp.counts.set(key, (grp.counts.get(key) || 0) + 1);
          if (!grp.sample.has(key)) grp.sample.set(key, { line: l.line, field, item });
        }
      }
      fields.push({ field, lines: ls });
    }
    perItem.push({ item, group: grp, fields });
  }

  // Boilerplate keys per group, minus lines a top-tier rule matches on their own.
  let protectedLines = 0;
  let boilerplateKeys = 0;
  if (cfg.boilerplate) {
    for (const grp of groups.values()) {
      grp.boiler = new Set();
      const need = Math.max(cfg.boilerplate.min_items, Math.ceil(cfg.boilerplate.min_share * grp.size));
      if (grp.size < cfg.boilerplate.min_items) continue;
      for (const [key, n] of grp.counts) {
        if (n < need) continue;
        const sample = grp.sample.get(key);
        if (topTierCheck && topTierCheck(sample.line, sample.field, sample.item)) {
          protectedLines++;
          continue;
        }
        grp.boiler.add(key);
        boilerplateKeys++;
      }
    }
  }

  // Pass 2: masks per item.
  let maskedItems = 0;
  let templateLines = 0;
  let boilerplateLines = 0;
  for (const { item, group, fields } of perItem) {
    const tkeys = keysBySource.get(item.source || '') || null;
    const out = [];
    for (const { field, lines: ls } of fields) {
      for (const l of ls) {
        if (tkeys && tkeys.has(l.key)) {
          out.push({ field, start: l.start, end: l.end, kind: 'template' });
          templateLines++;
          continue;
        }
        if (group.boiler && group.boiler.has(l.key)) {
          out.push({ field, start: l.start, end: l.end, kind: 'boilerplate' });
          boilerplateLines++;
          continue;
        }
        if (tkeys && l.words.length > 2) {
          // The longest template prefix of at least two words: "**Version used**: 3.2.1" after a "**Version used**:"
          // prompt masks the prompt and keeps "3.2.1". A one-word prompt is too common a word to strip from a line.
          let prefix = l.words[0].w;
          let best = -1;
          for (let k = 1; k < Math.min(l.words.length - 1, MAX_PREFIX_WORDS); k++) {
            prefix += ' ' + l.words[k].w;
            if (tkeys.has(prefix)) best = k;
          }
          if (best >= 1) {
            out.push({ field, start: l.start, end: l.start + l.words[best].e, kind: 'template' });
            templateLines++;
          }
        }
      }
    }
    if (out.length) {
      maskedItems++;
      masks.set(item.id, out);
    }
  }
  const summary = {
    templates: Object.fromEntries([...keysBySource].map(([src, keys]) => [src, keys.size])),
    boilerplate: cfg.boilerplate ? { min_share: cfg.boilerplate.min_share, min_items: cfg.boilerplate.min_items, distinct_lines: boilerplateKeys, kept_top_tier_lines: protectedLines } : null,
    items_masked: maskedItems,
    template_lines_masked: templateLines,
    boilerplate_lines_masked: boilerplateLines,
  };
  return { masks, summary };
}

/** Blank the masked ranges of one field's text with spaces (newlines kept), preserving length and offsets. */
export function applyMask(text, ranges) {
  if (!ranges || !ranges.length) return text;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const r of sorted) {
    const s = Math.max(pos, r.start);
    const e = Math.min(text.length, r.end);
    if (e <= s) continue;
    out += text.slice(pos, s) + text.slice(s, e).replace(/[^\n]/g, ' ');
    pos = e;
  }
  return out + text.slice(pos);
}
