// pack lint: static and fixture checks on a pack, beyond `validate`.
// Errors (exit 1): schema or semantic errors, duplicate rule ids, a regex that does not compile, a source without
// a citation or an https URL, a research pack without research mode and the exact banner.
// Warnings (exit 4 with --strict): a long or nested-quantifier regex (backtracking risk), two rules with the same
// match tree, a top-tier rule with no labelled example where its words appear negated (missing negation test),
// a rule that fires on no labelled example (missing positive fixture), a rule without a category.
// Labelled examples: bench/<pack>/dev.jsonl for bundled packs (never the held-out test split), and
// labelled.jsonl in the pack folder.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './util.js';
import { resolvePackPath, semanticErrors, compilePack, SCHEMA_DIR, PACKS_DIR, RESEARCH_BANNER } from './pack.js';
import { validate } from './jsonschema.js';
import { canonicalJson } from './snapshot/canonical.js';
import { loadItems } from './adapters/index.js';
import { triage } from './engine.js';
import { stripGold } from './items.js';

const NESTED = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/;

function walk(cond, fn) {
  fn(cond);
  for (const k of ['any', 'all', 'none']) if (Array.isArray(cond[k])) cond[k].forEach((c) => walk(c, fn));
}

function regexChecks(where, source, errors, warnings) {
  try {
    new RegExp(source, 'giu');
  } catch (e) {
    errors.push({ code: 'regex_invalid', where, message: `${where}: regex does not compile: ${e.message}` });
    return;
  }
  if (source.length > 300) warnings.push({ code: 'regex_long', where, message: `${where}: regex is ${source.length} characters; keep regexes short and bounded` });
  if (NESTED.test(source)) warnings.push({ code: 'regex_backtracking', where, message: `${where}: a quantified group contains a quantifier (possible catastrophic backtracking)` });
}

export function lintPack(arg) {
  const file = resolvePackPath(arg);
  const raw = readJson(file);
  const errors = [];
  const warnings = [];
  const schema = validate(readJson(path.join(SCHEMA_DIR, 'pack.schema.json')), raw);
  for (const m of schema) errors.push({ code: 'schema', message: m });
  for (const m of semanticErrors(raw)) errors.push({ code: 'semantic', message: m });
  const rules = Array.isArray(raw.rules) ? raw.rules : [];
  const ids = new Map();
  for (const r of rules) {
    if (ids.has(r.id)) errors.push({ code: 'duplicate_rule_id', where: r.id, message: `rule id ${r.id} appears more than once` });
    ids.set(r.id, r);
    if (!r.source || typeof r.source.citation !== 'string' || !r.source.citation.trim()) errors.push({ code: 'source_citation', where: r.id, message: `${r.id}: source.citation is missing` });
    if (!r.source || !/^https:\/\/\S+$/.test(String(r.source.url || ''))) errors.push({ code: 'source_url', where: r.id, message: `${r.id}: source.url must be an https URL` });
    if (!r.category) warnings.push({ code: 'missing_category', where: r.id, message: `${r.id}: no category (eval cannot group its misses)` });
    if (r.match) walk(r.match, (c) => {
      if (typeof c.regex === 'string') regexChecks(`${r.id} regex`, c.regex, errors, warnings);
    });
  }
  if (raw.inherit && typeof raw.inherit.regex === 'string') regexChecks('inherit.regex', raw.inherit.regex, errors, warnings);
  for (const kind of ['numbers', 'clocks']) for (const [name, def] of Object.entries(raw[kind] || {})) for (const p of def.patterns || []) regexChecks(`${kind}.${name}`, p, errors, warnings);
  const seenMatch = new Map();
  for (const r of rules) {
    const k = canonicalJson(r.match ?? null);
    if (seenMatch.has(k)) warnings.push({ code: 'duplicate_rule', where: r.id, message: `${r.id} has the same match tree as ${seenMatch.get(k)}` });
    else seenMatch.set(k, r.id);
  }
  // Policy separation.
  const bundled = path.join(PACKS_DIR, String(raw.name), 'pack.json');
  const namedLikeResearch = fs.existsSync(bundled) && readJson(bundled).mode === 'research';
  if ((namedLikeResearch || raw.banner) && raw.mode !== 'research') errors.push({ code: 'policy', message: 'a pack with a research banner or a research pack name must keep "mode": "research"' });
  if (raw.mode === 'research' && raw.banner !== RESEARCH_BANNER) errors.push({ code: 'policy', message: 'a research pack must carry the exact research banner' });
  if (raw.mode === 'research' && raw.inherit) warnings.push({ code: 'policy', message: 'a research pack should not inherit tiers from linked items' });

  // Fixture checks.
  const fixtures = [];
  const name = String(raw.name);
  const isBundled = path.resolve(path.dirname(file)) === path.resolve(PACKS_DIR, name);
  const candidates = [path.join(path.dirname(file), 'labelled.jsonl')];
  // Development split only: lint never reads a held-out (test) split.
  if (isBundled) candidates.push(path.join(PACKS_DIR, '..', 'bench', name, 'dev.jsonl'));
  for (const f of candidates) if (fs.existsSync(f) && fs.statSync(f).size > 0) fixtures.push(f);
  const checked = { fixtures: fixtures.map((f) => path.relative(path.join(PACKS_DIR, '..'), f).replace(/\\/g, '/')), rules: rules.length };
  if (!errors.length && fixtures.length) {
    const pack = compilePack(raw, file);
    const fired = new Set();
    const negated = new Set();
    for (const f of fixtures) {
      let items;
      try {
        items = loadItems(f).items.map(stripGold);
      } catch {
        continue;
      }
      if (!items.length) continue;
      const res = triage(items, pack, {});
      for (const r of res.items) {
        for (const x of r.rules) fired.add(x.id);
        for (const s of r.suppressed) if (s.context === 'negated') negated.add(s.rule);
      }
    }
    for (const r of rules) {
      if (r.tier === raw.tiers[0].id && !negated.has(r.id)) warnings.push({ code: 'missing_negation_test', where: r.id, message: `${r.id}: no labelled example mentions its words negated (add one where the words appear negated, so the negation handling is tested)` });
      if (!fired.has(r.id)) warnings.push({ code: 'missing_positive_fixture', where: r.id, message: `${r.id}: fires on no labelled example` });
    }
  } else if (!fixtures.length) warnings.push({ code: 'no_fixtures', message: 'no labelled examples found (labelled.jsonl in the pack folder, or bench/<pack>/ for a bundled pack)' });
  return { schemaVersion: 1, kind: 'urgent-first-pack-lint', pack: { name: raw.name, version: raw.version, mode: raw.mode || 'standard' }, ok: errors.length === 0, errors, warnings, checked };
}
