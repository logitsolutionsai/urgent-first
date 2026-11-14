import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { computeResults, tableFor, targetsFor, BENCHES } from '../scripts/update-bench-results.js';
import { loadPack, listPacks, semanticErrors } from '../src/pack.js';
import { readJson } from '../src/util.js';
import { validate } from '../src/jsonschema.js';

const published = readJson(path.join(ROOT, 'bench', 'results.json'));
const fresh = computeResults();

test('every bundled pack is valid against schema/pack.schema.json and the semantic checks', () => {
  const schema = readJson(path.join(ROOT, 'schema', 'pack.schema.json'));
  const names = listPacks();
  for (const n of ['radiology-research', 'github-maintainer', 'oncall']) assert.ok(names.includes(n), n);
  for (const n of names) {
    const raw = readJson(path.join(ROOT, 'packs', n, 'pack.json'));
    assert.deepEqual(validate(schema, raw), [], `${n} schema`);
    assert.deepEqual(semanticErrors(raw), [], `${n} semantic`);
    assert.ok(fs.existsSync(path.join(ROOT, 'packs', n, 'README.md')), `${n} README`);
    assert.ok(fs.existsSync(path.join(ROOT, 'packs', n, 'review.md')), `${n} review.md`);
    const pack = loadPack(n);
    for (const r of pack.rules) assert.match(r.source.url, /^https:\/\//, `${n} ${r.id} source url`);
  }
});

test('the schema rejects a broken pack with useful messages', () => {
  const schema = readJson(path.join(ROOT, 'schema', 'pack.schema.json'));
  const errors = validate(schema, { name: 'Bad Name', version: '1', title: 't', tiers: [{ id: 'T1' }], rules: [{ id: 'x', tier: 'T1', title: 't', why: 'w', source: { citation: 'c' }, match: { terms: [] } }] });
  const text = errors.join('\n');
  assert.match(text, /\$\.name: does not match/);
  assert.match(text, /\$\.tiers: needs at least 2/);
  assert.match(text, /missing required "url"/);
  const sem = semanticErrors({ name: 'p', version: '1.0.0', title: 't', tiers: [{ id: 'A', name: 'a' }, { id: 'B', name: 'b' }], rules: [{ id: 'R', tier: 'B', title: 't', why: 'w', source: { citation: 'c', url: 'https://x' }, match: { field: 'location', equals: 'ED' } }] });
  assert.ok(sem.some((e) => /baseline tier B cannot raise/.test(e)));
  assert.ok(sem.some((e) => /needs at least one condition that can quote text/.test(e)));
});

test('the radiology benchmark has enough gold T1 cases in test for a meaningful lower bound', () => {
  const t = fresh['radiology-research'].test.rules_only;
  assert.ok(t.gold_t1 >= 80, `test has ${t.gold_t1} gold T1`);
  assert.equal(t.items, 180);
  assert.equal(fresh['radiology-research'].dev.rules_only.items, 120);
});

test('every benchmark case is marked synthetic and carries gold tier, category and rationale', () => {
  for (const name of BENCHES) {
    for (const split of ['dev', 'test']) {
      const rows = fs.readFileSync(path.join(ROOT, 'bench', name, `${split}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
      for (const r of rows) {
        assert.equal(r.synthetic, true, r.id);
        assert.ok(['T1', 'T2', 'T3'].includes(r.gold.tier), r.id);
        assert.ok(r.gold.category && r.gold.rationale, r.id);
      }
    }
  }
});

for (const name of BENCHES) {
  test(`eval on ${name} reproduces the published numbers (bench/results.json)`, () => {
    assert.deepEqual(fresh[name], published[name]);
  });
  test(`${name}: the README tables equal what eval prints now`, () => {
    const table = tableFor(name, fresh);
    for (const f of targetsFor(name)) {
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (!text.includes(`<!-- bench:${name}:start -->`)) continue;
      assert.ok(text.includes(table), `${path.relative(ROOT, f)} has a stale ${name} table: run npm run bench`);
    }
  });
}

test('the main README and both flagship pack READMEs publish their tables', () => {
  const main = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const name of ['radiology-research', 'github-maintainer']) {
    assert.ok(main.includes(`<!-- bench:${name}:start -->`), `README.md lacks ${name}`);
    assert.ok(fs.readFileSync(path.join(ROOT, 'packs', name, 'README.md'), 'utf8').includes(`<!-- bench:${name}:start -->`));
  }
});

test('every README that the bench script updates carries its table (none is skipped silently)', () => {
  for (const name of BENCHES) {
    for (const f of targetsFor(name)) {
      assert.ok(fs.existsSync(f), `${path.relative(ROOT, f)} is missing`);
      const text = fs.readFileSync(f, 'utf8');
      assert.ok(text.includes(`<!-- bench:${name}:start -->`) && text.includes(`<!-- bench:${name}:end -->`), `${path.relative(ROOT, f)} has no ${name} table`);
    }
  }
});

test('benchmark numbers quoted in README prose equal what eval prints now', () => {
  const gh = fresh['github-maintainer'].test;
  const rad = fresh['radiology-research'].test.rules_only;
  const main = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const m = /missed (\d+) of (\d+) T1 GitHub issues and (\d+) of (\d+) T1 radiology orders on test/.exec(main);
  assert.ok(m, 'README.md states the test misses');
  assert.deepEqual(m.slice(1).map(Number), [gh.rules_only.missed_t1.length, gh.rules_only.gold_t1, rad.missed_t1.length, rad.gold_t1]);
  const packText = fs.readFileSync(path.join(ROOT, 'packs', 'github-maintainer', 'README.md'), 'utf8');
  const p = /the rules alone missed (\d+) of (\d+) T1 issues/.exec(packText);
  assert.ok(p, 'pack README states the test misses');
  assert.deepEqual(p.slice(1).map(Number), [gh.rules_only.missed_t1.length, gh.rules_only.gold_t1]);
  const radText = fs.readFileSync(path.join(ROOT, 'packs', 'radiology-research', 'README.md'), 'utf8');
  const r = /the rules alone missed (\d+) of (\d+) T1 cases/.exec(radText);
  assert.ok(r, 'radiology README states the test misses');
  assert.deepEqual(r.slice(1).map(Number), [rad.missed_t1.length, rad.gold_t1]);
});

// ---------- bench/github-real: references only, numbers reproducible from the fetched cache ----------

const REAL = path.join(ROOT, 'bench', 'github-real');

test('github-real stores no text: ids.jsonl holds only ref, gold and label, and results.json only derived numbers', async () => {
  const { readIds } = await import('../src/benchfetch.js');
  const rows = readIds(path.join(REAL, 'ids.jsonl'));
  assert.ok(rows.length >= 150, `${rows.length} items`);
  assert.ok(rows.filter((r) => r.gold !== 'T3').length >= 40, 'at least 40 urgent-labelled items');
  const raw = fs.readFileSync(path.join(REAL, 'ids.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  for (const r of raw) assert.deepEqual(Object.keys(r).sort(), ['gold', 'label', 'ref']);
  const splits = readJson(path.join(REAL, 'splits.json'));
  const repos = new Set(rows.map((r) => `${r.owner}/${r.repo}`));
  assert.deepEqual([...splits.dev, ...splits.heldout].sort(), [...repos].sort(), 'every repository is in exactly one split');
  assert.equal(splits.dev.filter((r) => splits.heldout.includes(r)).length, 0);
  const res = readJson(path.join(REAL, 'results.json'));
  for (const p of res.predictions) {
    const keys = Object.keys(p).sort();
    assert.deepEqual(keys.filter((k) => k !== 'review'), ['after', 'before', 'gold', 'label', 'ref']);
  }
  assert.ok(!JSON.stringify(res).includes('"title"') && !JSON.stringify(res).includes('"body"'));
});

test('github-real: the review annotations hold only short quotes, for items of their own split, and every split row is published', async () => {
  const { REVIEW } = await import('../scripts/bench-real.js');
  const splits = readJson(path.join(REAL, 'splits.json'));
  const res = readJson(path.join(REAL, 'results.json'));
  const refs = new Set(fs.readFileSync(path.join(REAL, 'ids.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).ref));
  assert.ok(res.review, 'results.json records the review pass');
  assert.equal(res.review.model, REVIEW.model);
  assert.ok(!/REVIEW_MODEL/.test(res.review.model), 'the reviewing model is recorded');
  for (const [split, file] of Object.entries(REVIEW.files)) {
    const f = path.join(REAL, file);
    if (!fs.existsSync(f)) continue;
    assert.ok(res.splits[split].review, `${split} has a rules + review row`);
    assert.equal(res.review.files[split], `bench/github-real/${file}`);
    assert.ok(fs.statSync(f).size < 40000, `${file} stays small`);
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    for (const a of lines) {
      assert.deepEqual(Object.keys(a).sort(), ['item_id', 'quotes', 'raise_to', 'reason', 'rule_id']);
      assert.ok(refs.has(a.item_id), `${a.item_id} is a benchmark item`);
      assert.ok(splits[split].includes(a.item_id.slice(0, a.item_id.indexOf('#'))), `${a.item_id} belongs to ${split}`);
      assert.ok(a.quotes.length >= 1 && a.quotes.length <= 4, `${a.item_id}: 1 to 4 quotes`);
      for (const q of a.quotes) assert.ok(q.length <= 200, `${a.item_id}: quote of ${q.length} characters is too long to publish`);
    }
    const v = res.review.validation[split];
    assert.equal(v.accepted + v.rejected, lines.length, `${split}: every annotation line was validated`);
  }
});

test('github-real: the README tables equal the published results.json', async () => {
  const { realTable, realTargets } = await import('../scripts/bench-real.js');
  const table = realTable(readJson(path.join(REAL, 'results.json')));
  for (const f of realTargets()) assert.ok(fs.readFileSync(f, 'utf8').includes(table), `${path.relative(ROOT, f)} has a stale github-real table: run node scripts/bench-real.js --write`);
});

test('github-real: the published numbers reproduce from the fetched items (skipped until bench-fetch has run)', async (t) => {
  const { computeReal, DEFAULT_ITEMS } = await import('../scripts/bench-real.js');
  const file = process.env.URGENT_FIRST_REAL_ITEMS || DEFAULT_ITEMS;
  if (!fs.existsSync(file)) return t.skip(`no fetched items at ${file}: run urgent-first bench-fetch bench/github-real/ids.jsonl`);
  assert.deepEqual(computeReal(file), readJson(path.join(REAL, 'results.json')));
});
