// P0: deterministic snapshots (snapshot.json, collection.json kept apart, partial-source semantics), reusing
// the existing engine. No live GitHub calls: every GitHub test uses recorded fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, runCli, tmpDir, github } from './helpers.js';
import { canonicalJson, digestOf } from '../src/snapshot/canonical.js';
import { buildSnapshot, loadSnapshot, verifySnapshot, itemIdentity, spanProblem, snapshotItemAsItem } from '../src/snapshot/snapshot.js';
import { normalizeItems, fieldValue } from '../src/items.js';
import { triage } from '../src/engine.js';
import { loadItems } from '../src/adapters/index.js';

const V31 = path.join(ROOT, 'examples', 'release-pulse', 'v3.1');
const V32 = path.join(ROOT, 'examples', 'release-pulse', 'v3.2');
const PARTIAL = path.join(ROOT, 'tests', 'fixtures', 'radar', 'partial');
const env = (fixture, extra = {}) => ({ env: { URGENT_FIRST_GITHUB_FIXTURE: fixture, URGENT_FIRST_CACHE: tmpDir('uf-cache-'), ...extra } });
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

export function snapGithub(fixture, args = [], extra = {}) {
  const out = path.join(tmpDir(), 'snap');
  const r = runCli(['snapshot', 'github', 'acme/widget', '--out', out, ...args], env(fixture, extra));
  return { ...r, out };
}

test('canonical JSON sorts keys at every depth and keeps array order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, 1], c: null } }), '{"a":{"c":null,"d":[3,1]},"b":1}');
  assert.equal(digestOf({ x: 1, y: 2 }), digestOf({ y: 2, x: 1 }));
  assert.notEqual(digestOf([1, 2]), digestOf([2, 1]));
  assert.throws(() => canonicalJson({ a: Infinity }));
});

test('snapshot github is byte-identical on repeat, carries no wall time or local path, and keeps timing in collection.json', () => {
  const a = snapGithub(V32);
  const b = snapGithub(V32);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  assert.equal(read(a.out, 'snapshot.json'), read(b.out, 'snapshot.json'));
  assert.equal(read(a.out, 'evidence-graph.json'), read(b.out, 'evidence-graph.json'));
  const snap = JSON.parse(read(a.out, 'snapshot.json'));
  const text = read(a.out, 'snapshot.json');
  assert.ok(!/collectedAt|durationMs/.test(text), 'no fetch timing in the snapshot');
  assert.ok(!text.includes(path.dirname(a.out)) && !text.includes(a.out), 'no local output path');
  const col = JSON.parse(read(a.out, 'collection.json'));
  assert.equal(col.snapshotId, snap.snapshotId);
  assert.ok(col.collectedAt && Number.isInteger(col.durationMs));
  assert.equal(snap.schemaVersion, 1);
  assert.equal(snap.kind, 'urgent-first-snapshot');
  assert.equal(snap.status, 'complete');
  assert.match(snap.snapshotId, /^sha256:[0-9a-f]{64}$/);
  assert.match(snap.pack.digest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(snap.source.scope, { state: 'open', limit: 100 });
  assert.equal(snap.source.complete, true);
  assert.deepEqual(snap.release, { tag: 'v3.2.0', publishedAt: '2026-11-10T00:00:00Z', source: 'github-release-api', url: 'https://github.com/acme/widget/releases/tag/v3.2.0' });
  assert.equal(snap.items.length, 16);
  assert.equal(snap.items[0].id, 'github:acme/widget:issue:717');
  assert.ok(snap.items.every((i) => i.synthetic), 'the fixture folder declares itself synthetic');
  assert.match(a.stdout, /Snapshot sha256:/);
});

test('the snapshot reuses the engine: tiers and board order equal the github command on the same fixture', () => {
  const s = snapGithub(V32);
  const run = path.join(tmpDir(), 'run');
  const r = runCli(['github', 'acme/widget', '--out', run, '--now', '2026-11-14T00:00:00Z'], env(V32));
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(read(run, 'results.rules.json'));
  const snap = JSON.parse(read(s.out, 'snapshot.json'));
  const byLocal = new Map(snap.items.map((i) => [i.localId, i]));
  for (const x of res.items) {
    const si = byLocal.get(x.id);
    assert.equal(si.effectiveTier, x.tier, x.id);
    assert.equal(si.boardPosition, x.position, x.id);
    assert.deepEqual(si.ruleIds, x.rules.map((y) => y.id), x.id);
  }
  // Unflagged items keep their original order.
  const unflagged = snap.items.filter((i) => i.effectiveTier === 'T3').sort((a, b) => a.boardPosition - b.boardPosition);
  assert.deepEqual(unflagged.map((i) => i.originalOrder), [...unflagged.map((i) => i.originalOrder)].sort((a, b) => a - b));
});

test('snapshotId is a digest of the content: key order on disk does not matter, an edit is refused', () => {
  const s = snapGithub(V31);
  const file = path.join(s.out, 'snapshot.json');
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(verifySnapshot(snap), []);
  // Same content, keys reversed: still verifies.
  const reversed = (v) => (Array.isArray(v) ? v.map(reversed) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reversed(v[k])])) : v);
  assert.deepEqual(verifySnapshot(reversed(snap)), []);
  // A changed title: the digest and the item content digest no longer match.
  const edited = structuredClone(snap);
  edited.items[0].title += ' (edited)';
  const problems = verifySnapshot(edited);
  assert.ok(problems.some((p) => /snapshotId does not match/.test(p)));
  assert.ok(problems.some((p) => /content digest mismatch/.test(p)));
  fs.writeFileSync(file, JSON.stringify(edited));
  const r = runCli(['links', s.out]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /failed verification/);
});

test('partial API collection: a rate-limited second page gives status partial with a reason and a continuation, never false totals', () => {
  const out = path.join(tmpDir(), 'snap');
  const r = runCli(['snapshot', 'github', 'acme/partial', '--limit', '150', '--out', out, '--json'], env(PARTIAL));
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.status, 'partial');
  const snap = JSON.parse(read(out, 'snapshot.json'));
  assert.equal(snap.status, 'partial');
  assert.equal(snap.source.complete, false);
  assert.equal(snap.source.reason, 'rate_limit');
  assert.match(snap.source.continuation, /page=2$/);
  assert.equal(snap.source.pageCount, 1);
  assert.equal(snap.items.length, 100);
  const codes = snap.warnings.map((w) => w.code);
  assert.ok(codes.includes('partial_source') && codes.includes('rate_limit_truncation'));
  // The flagged item on the first page is still evidence-backed and shown.
  assert.ok(snap.items.some((i) => i.effectiveTier === 'T1'));
  const col = JSON.parse(read(out, 'collection.json'));
  assert.equal(col.stoppedBy.reason, 'rate_limit');
  // The text summary says the totals are partial.
  const r2 = runCli(['snapshot', 'github', 'acme/partial', '--limit', '150', '--out', path.join(tmpDir(), 's')], env(PARTIAL));
  assert.match(r2.stdout, /status partial \(rate_limit\): totals cover only what was collected/);
});

test('a --limit that stops the listing early is partial with reason limit_reached', () => {
  const s = snapGithub(V32, ['--limit', '3']);
  assert.equal(s.code, 0, s.stderr);
  const snap = JSON.parse(read(s.out, 'snapshot.json'));
  assert.equal(snap.items.length, 3);
  assert.equal(snap.source.complete, false);
  assert.equal(snap.source.reason, 'limit_reached');
});

test('the github command still fails fast on a rate-limited page (partial mode is snapshot only)', () => {
  const r = runCli(['github', 'acme/partial', '--limit', '150', '--out', path.join(tmpDir(), 'run')], env(PARTIAL));
  assert.equal(r.code, 3);
  assert.match(r.stderr, /Rate limit reached/);
});

test('evidence exactness: multi-byte Unicode and CRLF spans reproduce the original substring; a tampered span is refused', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'items.jsonl');
  const rows = [
    { id: 'u1', title: 'Export 📦 wipes 😱 my vault', text: { body: 'Héllo 👋🏽 team,\r\nafter the update I lost all my notes 📝 and the backup is empty.\r\nThanks' }, synthetic: true },
    { id: 'u2', title: 'Ünïcödé title', text: { body: 'Line one\r\nWe had no data loss 🎉, only a slow sync.\r\n' }, synthetic: true },
  ];
  fs.writeFileSync(file, rows.map((x) => JSON.stringify(x)).join('\n'));
  const out = path.join(dir, 'snap');
  const r = runCli(['snapshot', 'run', 'github-maintainer', file, '--out', out]);
  assert.equal(r.code, 0, r.stderr);
  const snap = JSON.parse(read(out, 'snapshot.json'));
  assert.ok(snap.evidence.length >= 1);
  const byId = new Map(snap.items.map((i) => [i.id, i]));
  for (const ev of snap.evidence) {
    const si = byId.get(ev.itemId);
    assert.equal(fieldValue(snapshotItemAsItem(si), ev.field).slice(ev.start, ev.end), ev.text, ev.id);
  }
  assert.equal(byId.get('item:local:u1').effectiveTier, 'T1');
  assert.equal(byId.get('item:local:u2').effectiveTier, 'T3', 'negated data loss does not raise');
  // A span shifted by one code unit (inside a surrogate pair) is refused.
  const ev = structuredClone(snap.evidence[0]);
  ev.start += 1;
  assert.ok(spanProblem(snapshotItemAsItem(byId.get(ev.itemId)), ev));
  // A malformed annotation is still rejected by the existing validator (merge), unchanged.
  const run = path.join(dir, 'run');
  assert.equal(runCli(['run', 'github-maintainer', file, '--out', run]).code, 0);
  const ann = path.join(dir, 'a.jsonl');
  fs.writeFileSync(ann, JSON.stringify({ item_id: 'u2', raise_to: 'T1', rule_id: 'LLM', reason: 'x', quotes: ['data loss 🎉 whatever'] }) + '\n');
  const m = runCli(['merge', run, ann]);
  assert.equal(m.code, 0);
  assert.match(m.stdout, /1 rejected/);
});

test('identity: GitHub items are repo + kind + number; numbers never match across repositories', () => {
  const [a, b] = normalizeItems([
    { id: '#5', title: 'x', source: 'github:acme/widget', metadata: { number: 5, type: 'issue' } },
    { id: 'other#5', title: 'x', source: 'github:acme/other', metadata: { number: 5, type: 'pull_request' } },
  ]);
  assert.equal(itemIdentity(a), 'github:acme/widget:issue:5');
  assert.equal(itemIdentity(b), 'github:acme/other:pull:5');
  const [c] = normalizeItems([{ id: 'T-9', title: 'x' }]);
  assert.equal(itemIdentity(c), 'item:local:T-9');
});

test('no credentials in snapshot or collection files', () => {
  const secret = 'ghp_SYNTHETICsecretTOKEN1234567890';
  const s = snapGithub(V31, [], { GITHUB_TOKEN: secret });
  assert.equal(s.code, 0, s.stderr);
  for (const f of fs.readdirSync(s.out)) assert.ok(!read(s.out, f).includes(secret), f);
  assert.ok(!s.stdout.includes(secret));
  assert.equal(JSON.parse(read(s.out, 'collection.json')).tokenUsed, true);
});

test('writing: refuses to replace a snapshot without --force, refuses a foreign folder, writes atomically', () => {
  const s = snapGithub(V31);
  const again = runCli(['snapshot', 'github', 'acme/widget', '--out', s.out], env(V31));
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already holds a snapshot/);
  const forced = runCli(['snapshot', 'github', 'acme/widget', '--out', s.out, '--force'], env(V31));
  assert.equal(forced.code, 0, forced.stderr);
  assert.ok(!fs.readdirSync(s.out).some((f) => f.includes('.tmp-')), 'no temp files left');
  const foreign = tmpDir();
  fs.writeFileSync(path.join(foreign, 'notes.txt'), 'mine');
  const r = runCli(['snapshot', 'github', 'acme/widget', '--out', foreign, '--force'], env(V31));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not an urgent-first snapshot folder/);
});

test('snapshot run equals the engine on the same file (dev benchmark), with gold labels stripped', () => {
  const file = path.join(ROOT, 'bench', 'github-maintainer', 'dev.jsonl');
  const out = path.join(tmpDir(), 'snap');
  const r = runCli(['snapshot', 'run', 'github-maintainer', file, '--out', out]);
  assert.equal(r.code, 0, r.stderr);
  const snap = loadSnapshot(out).snapshot;
  const pack = github();
  const items = loadItems(file).items.map(({ gold, ...x }) => x);
  const res = triage(items, pack, {});
  assert.deepEqual(snap.items.map((i) => [i.localId, i.effectiveTier]), items.map((it) => [it.id, res.items.find((x) => x.id === it.id).tier]));
  assert.ok(!read(out, 'snapshot.json').includes('"gold"'), 'gold labels never enter a snapshot');
  // Building twice in memory gives the same id (determinism without the CLI).
  const a = buildSnapshot({ pack, items, result: res, source: { kind: 'file', input: 'dev.jsonl', scope: { kind: 'file' }, complete: true } });
  const b = buildSnapshot({ pack, items, result: triage(items, pack, {}), source: { kind: 'file', input: 'dev.jsonl', scope: { kind: 'file' }, complete: true } });
  assert.equal(a.snapshotId, b.snapshotId);
  assert.throws(() => buildSnapshot({ pack, items, result: res, source: { kind: 'file', complete: false } }), /needs a reason/);
});

test('diagnostics are first-class objects: unknown priority, ambiguous negation, excessive template masking', () => {
  const s = snapGithub(V31);
  const snap = JSON.parse(read(s.out, 'snapshot.json'));
  const codes = snap.warnings.map((w) => w.code);
  assert.ok(codes.includes('ambiguous_negation'), codes.join(','));
  const amb = snap.warnings.find((w) => w.code === 'ambiguous_negation');
  assert.ok(amb.itemIds.includes('github:acme/widget:issue:710'));
  for (const w of snap.warnings) assert.ok(w.code && w.severity && w.message && Array.isArray(w.itemIds), JSON.stringify(w));
});

test('optional live smoke test: snapshot of a real public repository (URGENT_FIRST_LIVE=1, a few API requests)', { skip: process.env.URGENT_FIRST_LIVE !== '1' }, () => {
  const out = path.join(tmpDir(), 'live');
  const r = runCli(['snapshot', 'github', 'nodejs/node', '--limit', '5', '--out', out, '--no-templates', '--linked-max', '0']);
  assert.equal(r.code, 0, r.stderr);
  const snap = JSON.parse(read(out, 'snapshot.json'));
  assert.ok(snap.items.length > 0 && snap.items.length <= 5);
  assert.equal(snap.source.reason, 'limit_reached');
  assert.ok(snap.items.every((i) => i.synthetic === false), 'live data is never marked synthetic');
});
