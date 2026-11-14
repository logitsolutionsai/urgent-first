import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli, tmpDir, ROOT } from './helpers.js';
import { RESEARCH_BANNER, loadPack } from '../src/pack.js';
import { normalizeItems } from '../src/items.js';
import { triage } from '../src/engine.js';
import { renderHtml } from '../src/render/html.js';
import { renderMarkdown } from '../src/render/markdown.js';

const FX = path.join(ROOT, 'tests', 'fixtures');
const BANNER =
  'Research and education software. Not a medical device; not cleared, approved or CE-marked. Not for patient care, including choosing which studies to read first. It reads only text, quotes the exact words that matched a rule, and never changes the ordered priority. Accuracy figures come from synthetic cases. Clinical use may be regulated as a medical device.';

test('research banner text is exactly the required wording', () => {
  assert.equal(RESEARCH_BANNER, BANNER);
  assert.equal(loadPack('radiology-research').banner, BANNER);
});

test('research mode: run writes the banner into board.md, board.html and review.md', () => {
  const out = path.join(tmpDir(), 'run');
  const r = runCli(['run', 'radiology-research', path.join(FX, 'orders.fhir.json'), '--out', out, '--now', '2026-04-07T09:45:00Z']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes(BANNER));
  const md = fs.readFileSync(path.join(out, 'board.md'), 'utf8');
  const html = fs.readFileSync(path.join(out, 'board.html'), 'utf8');
  assert.ok(md.includes(BANNER));
  assert.ok(html.includes(BANNER));
  assert.match(html, /id="research-banner"/);
  const t = runCli(['annotate-template', out]);
  assert.equal(t.code, 0, t.stderr);
  assert.ok(fs.readFileSync(path.join(out, 'review.md'), 'utf8').includes(BANNER));
});

test('research mode: watch refuses, also through github --watch', () => {
  const w = runCli(['watch', 'radiology-research', path.join(FX, 'orders.fhir.json'), '--polls', '1']);
  assert.equal(w.code, 2);
  assert.match(w.stderr, /research mode: watch is disabled/);
  const g = runCli(['github', 'acme/widget', '--pack', 'radiology-research', '--watch'], { env: { URGENT_FIRST_GITHUB_FIXTURE: path.join(FX, 'github') } });
  assert.equal(g.code, 2);
  assert.match(g.stderr, /watch is disabled/);
});

test('research mode: non-synthetic input is refused', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'real.jsonl');
  fs.writeFileSync(f, JSON.stringify({ id: 'a', title: 'CT head', text: { reason: 'headache' }, priority: 'routine' }) + '\n');
  const r = runCli(['run', 'radiology-research', f, '--out', path.join(dir, 'out')]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /accepts synthetic data only/);
  assert.ok(!fs.existsSync(path.join(dir, 'out', 'board.md')));
});

test('a run only writes inside its own output folder and refuses a foreign non-empty folder', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'mine');
  const r = runCli(['run', 'radiology-research', path.join(FX, 'orders.fhir.json'), '--out', dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not an urgent-first run folder/);
  const out = path.join(dir, 'run');
  const ok = runCli(['run', 'radiology-research', path.join(FX, 'orders.fhir.json'), '--out', out]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['notes.txt', 'run']);
});

test('boards never contain a safe, routine or can-wait list', () => {
  const pack = loadPack('radiology-research');
  const items = normalizeItems([
    { id: 'a', title: 'CT head', text: { reason: 'Sudden facial droop' }, priority: 'routine', synthetic: true },
    { id: 'b', title: 'XR knee', text: { reason: 'Chronic pain' }, priority: 'routine', synthetic: true },
  ]);
  const res = triage(items, pack, { now: '2026-04-07T12:00:00Z' });
  const md = renderMarkdown(res, { pack });
  const html = renderHtml(res, { pack, itemsById: new Map(items.map((i) => [i.id, i])) });
  for (const text of [md, html]) {
    assert.match(text, /No rule matched/);
    assert.match(text, /does not mean not urgent/);
    assert.doesNotMatch(text, /safe to wait|can wait|safe list|routine list|not urgent list/i);
  }
});

test('GitHub board from a recorded response: data loss, security and the regression come first', () => {
  const out = path.join(tmpDir(), 'gh');
  const r = runCli(['github', 'acme/widget', '--out', out, '--now', '2026-10-22T12:00:00Z'], { env: { URGENT_FIRST_GITHUB_FIXTURE: path.join(FX, 'github') } });
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
  const t1 = res.items.filter((x) => x.tier === 'T1').map((x) => x.id);
  for (const id of ['#812', '#799', '#805', '#790']) assert.ok(t1.includes(id), id);
  const i812 = res.items.find((x) => x.id === '#812');
  assert.ok(i812.rules[0].evidence.some((e) => e.text.includes('lost all my saved projects')));
  for (const id of ['#815', '#819', '#820', '#801']) assert.equal(res.items.find((x) => x.id === id).tier, 'T3', id);
});

test('github --watch polls with ETags and announces new urgent items', () => {
  // The fixture server returns the same ETag, so the first poll costs a 304 and changes nothing.
  const out = path.join(tmpDir(), 'ghw');
  const r = runCli(['github', 'acme/widget', '--out', out, '--watch', '--interval', '0', '--polls', '1'], { env: { URGENT_FIRST_GITHUB_FIXTURE: path.join(FX, 'github') } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Watching acme\/widget/);
  assert.doesNotMatch(r.stdout, /board updated/);
});

test('watch on a folder rewrites the board and marks new items', async () => {
  const dir = tmpDir();
  const inbox = path.join(dir, 'inbox');
  fs.mkdirSync(inbox);
  const first = { id: 'oc-a', title: 'How do I export?', text: { body: 'Is there an export API?' }, priority: 'P4' };
  fs.writeFileSync(path.join(inbox, 'a.jsonl'), JSON.stringify(first) + '\n');
  const out = path.join(dir, 'board');
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'urgent-first.mjs'), 'watch', 'oncall', inbox, '--out', out, '--interval', '0.3', '--polls', '12'], { cwd: ROOT });
  let stdout = '';
  child.stdout.on('data', (d) => (stdout += d));
  await new Promise((res) => setTimeout(res, 900));
  const second = { id: 'oc-b', title: 'Everything down in EU', text: { body: 'Since 09:05 every customer in Europe gets errors. Status page is green.' }, priority: 'P3' };
  fs.writeFileSync(path.join(inbox, 'b.jsonl'), JSON.stringify(second) + '\n');
  const code = await new Promise((res) => child.on('close', res));
  assert.equal(code, 0);
  assert.match(stdout, /NEW T1 oc-b/);
  const md = fs.readFileSync(path.join(out, 'board.md'), 'utf8');
  assert.match(md, /New since last look: 1/);
  assert.match(md, /\*\*oc-b\*\*.*\*\*NEW\*\*/);
  const seen = runCli(['seen', out]);
  assert.equal(seen.code, 0, seen.stderr);
  assert.match(fs.readFileSync(path.join(out, 'board.md'), 'utf8'), /New since last look: 0/);
});

test('annotate-template, merge and shadow through the CLI', () => {
  const out = path.join(tmpDir(), 'run');
  assert.equal(runCli(['run', 'radiology-research', path.join(FX, 'orders.fhir.json'), '--out', out, '--now', '2026-04-07T09:45:00Z']).code, 0);
  const t = runCli(['annotate-template', out]);
  assert.equal(t.code, 0, t.stderr);
  const queue = fs.readFileSync(path.join(out, 'review.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(queue.some((q) => q.item_id === 'fx-002'));
  const ann = path.join(out, 'annotations.jsonl');
  fs.writeFileSync(
    ann,
    [
      { item_id: 'fx-002', raise_to: 'T2', rule_id: 'LLM', reason: 'test raise', quotes: ['Memory decline over 18 months'] },
      { item_id: 'fx-002', raise_to: 'T1', rule_id: 'LLM', reason: 'invented quote', quotes: ['sudden collapse'] },
    ].map((x) => JSON.stringify(x)).join('\n') + '\n',
  );
  const m = runCli(['merge', out, ann]);
  assert.equal(m.code, 0, m.stderr);
  assert.match(m.stdout, /1 accepted \(1 raised a tier\), 1 rejected/);
  assert.equal(runCli(['merge', out, ann, '--strict']).code, 4);
  const md = fs.readFileSync(path.join(out, 'board.md'), 'utf8');
  assert.match(md, /Annotation LLM \(T2, raised\)/);
  assert.match(md, /Rejected Annotations \(1\)/);
  const s = runCli(['shadow', out, '--picks', 'fx-003', 'fx-002']);
  assert.equal(s.code, 0, s.stderr);
  assert.match(s.stdout, /Top-2 overlap with the board: 1\/2/);
  assert.match(s.stdout, /T1 on the board but not picked: fx-001/);
  assert.ok(fs.existsSync(path.join(out, 'shadow.jsonl')));
});

test('eval --strict exits non-zero when a T1 is missed, and --json is machine-readable', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'l.jsonl');
  fs.writeFileSync(
    f,
    [
      { id: 'a', title: 'CT head', text: { reason: 'Sudden facial droop' }, priority: 'routine', synthetic: true, gold: { tier: 'T1' } },
      { id: 'b', title: 'CT head', text: { reason: 'something vague' }, priority: 'routine', synthetic: true, gold: { tier: 'T1' } },
      { id: 'c', title: 'XR knee', text: { reason: 'Chronic pain' }, priority: 'routine', synthetic: true, gold: { tier: 'T3' } },
    ].map((x) => JSON.stringify(x)).join('\n'),
  );
  const j = runCli(['eval', 'radiology-research', f, '--json']);
  assert.equal(j.code, 0);
  const rep = JSON.parse(j.stdout);
  assert.equal(rep.rules_only.critical_sensitivity.caught, 1);
  assert.equal(rep.rules_only.missed_critical[0].id, 'b');
  assert.equal(runCli(['eval', 'radiology-research', f, '--strict']).code, 4);
});

test('explain and validate commands', () => {
  const e = runCli(['explain', 'radiology-research', 'No history of stroke. r/o PE.']);
  assert.equal(e.code, 0, e.stderr);
  assert.match(e.stdout, /PULMONARY-EMBOLISM \(T1\): "r\/o PE" \[suspected\]/);
  assert.match(e.stdout, /STROKE: "stroke" \[negated\]/);
  for (const p of ['radiology-research', 'github-maintainer', 'oncall']) assert.equal(runCli(['validate', p]).code, 0, p);
});
