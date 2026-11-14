// Load, validate and compile a pack (packs/<name>/pack.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, UserError } from './util.js';
import { validate } from './jsonschema.js';
import { compileAbbreviations } from './match/text.js';
import { compileCues } from './match/context.js';
import { compilePatterns } from './match/extract.js';
import { QUOTED_FIELDS } from './match/conditions.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const PACKS_DIR = path.join(ROOT, 'packs');
export const SCHEMA_DIR = path.join(ROOT, 'schema');

export const RESEARCH_BANNER =
  'Research and education software. Not a medical device; not cleared, approved or CE-marked. Not for patient care, including choosing which studies to read first. It reads only text, quotes the exact words that matched a rule, and never changes the ordered priority. Accuracy figures come from synthetic cases. Clinical use may be regulated as a medical device.';

export function listPacks() {
  if (!fs.existsSync(PACKS_DIR)) return [];
  return fs
    .readdirSync(PACKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(PACKS_DIR, d.name, 'pack.json')))
    .map((d) => d.name)
    .sort();
}

/** Resolve a pack argument: a bundled pack name, a folder containing pack.json, or a pack.json path. */
export function resolvePackPath(arg) {
  if (!arg) throw new UserError('Missing pack name');
  const candidates = [];
  if (/^[a-z0-9][a-z0-9-]*$/.test(arg)) candidates.push(path.join(PACKS_DIR, arg, 'pack.json'));
  candidates.push(path.resolve(arg, 'pack.json'), path.resolve(arg));
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  throw new UserError(`Pack "${arg}" not found. Bundled packs: ${listPacks().join(', ') || '(none)'}`);
}

let packSchema = null;
function getSchema() {
  if (!packSchema) packSchema = readJson(path.join(SCHEMA_DIR, 'pack.schema.json'));
  return packSchema;
}

function walkConditions(cond, fn, at) {
  fn(cond, at);
  for (const key of ['any', 'all', 'none']) {
    if (Array.isArray(cond[key])) cond[key].forEach((c, i) => walkConditions(c, fn, `${at}.${key}[${i}]`));
  }
}

/** Semantic checks beyond the JSON Schema. Returns a list of error strings (empty when valid). */
export function semanticErrors(pack) {
  const errors = [];
  const tierIds = pack.tiers.map((t) => t.id);
  const tierSet = new Set(tierIds);
  if (tierSet.size !== tierIds.length) errors.push('tiers: duplicate tier id');
  const baseline = tierIds[tierIds.length - 1];
  const checkTier = (t, where) => {
    if (!tierSet.has(t)) errors.push(`${where}: unknown tier "${t}" (known: ${tierIds.join(', ')})`);
  };
  for (const [k, t] of Object.entries(pack.floor?.priority || {})) checkTier(t, `floor.priority.${k}`);
  (pack.floor?.labels || []).forEach((l, i) => checkTier(l.tier, `floor.labels[${i}]`));
  const ruleIds = new Set();
  if (pack.inherit) {
    if (pack.rules.some((r) => r.id === pack.inherit.id)) errors.push(`inherit.id: "${pack.inherit.id}" is also a rule id`);
    if (pack.inherit.id === 'LLM') errors.push('inherit.id: "LLM" is reserved for annotations');
    try {
      const re = new RegExp(pack.inherit.regex, 'u');
      if (!/\((?!\?)/.test(re.source)) errors.push('inherit.regex: needs a capture group for the linked item number');
    } catch (err) {
      errors.push(`inherit.regex: invalid regex: ${err.message}`);
    }
  }
  pack.rules.forEach((rule, i) => {
    const where = `rules[${i}] (${rule.id})`;
    if (ruleIds.has(rule.id)) errors.push(`${where}: duplicate rule id`);
    ruleIds.add(rule.id);
    if (rule.id === 'LLM') errors.push(`${where}: "LLM" is reserved for annotations`);
    checkTier(rule.tier, where);
    if (rule.tier === baseline) errors.push(`${where}: a rule at the baseline tier ${baseline} cannot raise anything`);
    let hasQuotable = false;
    walkConditions(rule.match, (c, at) => {
      if (c.terms || c.near || c.regex || c.number || c.clock || c.mentions) hasQuotable = true;
      // A field condition quotes only a field shown on the board (labels, title, location, priority).
      if (c.field && (c.in || c.matches) && (c.field === 'labels' || QUOTED_FIELDS.has(c.field))) hasQuotable = true;
      if (c.regex && /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(c.regex)) errors.push(`${where}${at}: regex contains a control character (in JSON a word boundary needs a doubled backslash)`);
      if (c.regex) {
        try {
          new RegExp(c.regex, 'u' + (c.flags || 'i').replace(/[gu]/g, ''));
        } catch (err) {
          errors.push(`${where}${at}: invalid regex: ${err.message}`);
        }
      }
      if (c.number && !(pack.numbers && pack.numbers[c.number])) errors.push(`${where}${at}: unknown number "${c.number}"`);
      if (c.clock && !(pack.clocks && pack.clocks[c.clock])) errors.push(`${where}${at}: unknown clock "${c.clock}"`);
      if (c.terms) c.terms.forEach((t) => { if (!/[\p{L}\p{N}]/u.test(t)) errors.push(`${where}${at}: empty term "${t}"`); });
    }, '.match');
    for (const n of rule.clocks || []) if (!(pack.clocks && pack.clocks[n])) errors.push(`${where}: unknown clock "${n}"`);
    if (!hasQuotable) errors.push(`${where}: needs at least one condition that can quote text (terms, near, regex, number, clock, mentions or a string field)`);
  });
  for (const [kind, defs] of [['numbers', pack.numbers || {}], ['clocks', pack.clocks || {}]]) {
    for (const [name, def] of Object.entries(defs)) {
      def.patterns.forEach((p, i) => {
        try {
          const re = new RegExp(p, 'giu');
          if (kind === 'clocks' && !/\(\?<(time|ago)>/.test(p)) errors.push(`${kind}.${name}.patterns[${i}]: needs a named group (?<time>...) or (?<ago>...)`);
          void re;
        } catch (err) {
          errors.push(`${kind}.${name}.patterns[${i}]: invalid regex: ${err.message}`);
        }
      });
    }
  }
  if (pack.mode === 'research') {
    if (pack.banner !== RESEARCH_BANNER) errors.push('banner: research-mode packs must carry the exact research banner text (see references/pack-format.md)');
  } else if (pack.banner) {
    // A copy of a research pack with only "mode" deleted would otherwise run with none of its safeguards.
    errors.push('banner: only research-mode packs carry a banner; set "mode": "research" (a research pack copied without its mode is refused)');
  }
  return errors;
}

/** Load and compile a pack. Throws UserError listing every problem. */
export function loadPack(arg) {
  const file = resolvePackPath(arg);
  const raw = readJson(file);
  const schemaErrors = validate(getSchema(), raw);
  if (schemaErrors.length) throw new UserError(`Pack ${file} does not match schema/pack.schema.json`, { details: schemaErrors });
  const semErrors = semanticErrors(raw);
  if (semErrors.length) throw new UserError(`Pack ${file} has errors`, { details: semErrors, code: semErrors.some((e) => e.startsWith('banner:')) ? 2 : 1 });
  // A pack named like a bundled research pack must stay in research mode, wherever it is loaded from.
  const bundled = path.join(PACKS_DIR, String(raw.name), 'pack.json');
  if (raw.mode !== 'research' && path.resolve(file) !== path.resolve(bundled) && fs.existsSync(bundled) && readJson(bundled).mode === 'research') {
    throw new UserError(`Pack ${file} is named "${raw.name}" like the bundled research pack but is not in research mode. Research packs keep "mode": "research".`, { code: 2 });
  }
  return compilePack(raw, file);
}

export function compilePack(raw, file = null) {
  const pack = structuredClone(raw);
  pack._file = file;
  pack._dir = file ? path.dirname(file) : null;
  pack.mode = pack.mode || 'standard';
  pack.matching = { typos: true, typo_min_length: 7, window: 6, ...(pack.matching || {}) };
  pack.floor = { priority: {}, labels: [], missing_priority: 'baseline', unknown_priority: 'baseline', ...(pack.floor || {}) };
  pack.numbers = pack.numbers || {};
  pack.clocks = pack.clocks || {};
  pack._abbrevs = compileAbbreviations(pack.abbreviations || {});
  pack._cues = compileCues(pack.context || {}, pack._abbrevs);
  for (const def of Object.values(pack.numbers)) Object.defineProperty(def, '_compiled', { value: compilePatterns(def.patterns), enumerable: false });
  for (const def of Object.values(pack.clocks)) Object.defineProperty(def, '_compiled', { value: compilePatterns(def.patterns), enumerable: false });
  pack._tierRank = new Map(pack.tiers.map((t, i) => [t.id, i]));
  pack._baseline = pack.tiers[pack.tiers.length - 1].id;
  pack._top = pack.tiers[0].id;
  pack._rules = new Map(pack.rules.map((r) => [r.id, r]));
  pack._priorityMap = new Map(Object.entries(pack.floor.priority).map(([k, v]) => [k.toLowerCase(), v]));
  return pack;
}

export function tierRank(pack, tierId) {
  const r = pack._tierRank.get(tierId);
  return r === undefined ? Infinity : r;
}

export function tierById(pack, id) {
  return pack.tiers.find((t) => t.id === id);
}

export function moreUrgent(pack, a, b) {
  return tierRank(pack, a) <= tierRank(pack, b) ? a : b;
}

export function packReviewGuide(pack) {
  if (!pack._dir) return null;
  const f = path.join(pack._dir, 'review.md');
  return fs.existsSync(f) ? f : null;
}
