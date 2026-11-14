// P1: the evidence graph and `links`: GitHub closing references, the candidate engine (inverted index,
// weighted Jaccard, contradiction guard, hard caps) and graph property tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, runCli, tmpDir, github } from './helpers.js';
import { parseReferences } from '../src/graph/github-links.js';
import { buildGraph, edgeId } from '../src/graph/build.js';
import { validateGraph } from '../src/graph/validate.js';
import { candidateLinks, LIMITS, THRESHOLDS } from '../src/graph/candidates.js';
import { snapshotFromFile } from '../src/graph/link-eval.js';
import { buildSnapshot, loadSnapshot } from '../src/snapshot/snapshot.js';
import { normalizeItems } from '../src/items.js';
import { triage } from '../src/engine.js';
import { seededRandom } from '../src/util.js';
import { computeLinkResults } from '../scripts/bench-links.js';

const V32 = path.join(ROOT, 'examples', 'release-pulse', 'v3.2');
const DEV = path.join(ROOT, 'bench', 'maintainer-radar', 'candidates.dev.jsonl');

function snapFromRows(rows, pack = github()) {
  const items = normalizeItems(rows);
  const result = triage(items, pack, {});
  return buildSnapshot({ pack, items, result, source: { kind: 'file', input: 'rows', scope: { kind: 'file' }, complete: true } });
}

function v32() {
  const out = path.join(tmpDir(), 'snap');
  const r = runCli(['snapshot', 'github', 'acme/widget', '--out', out], { env: { URGENT_FIRST_GITHUB_FIXTURE: V32, URGENT_FIRST_CACHE: tmpDir('uf-cache-') } });
  assert.equal(r.code, 0, r.stderr);
  return loadSnapshot(out);
}

const pr = (body, title = 'A change') => ({ title, text: { body }, kind: 'pull_request' });
const iss = (body, title = 'A report') => ({ title, text: { body }, kind: 'issue' });

test('closing references: only GitHub closing keywords in a pull request are fixes; everything else is a reference', () => {
  const t = (item) => parseReferences(item, 'acme/widget').map((r) => `${r.type}:${r.repository}#${r.number}:${r.text}`);
  assert.deepEqual(t(pr('Fixes #812')), ['fixes:acme/widget#812:Fixes #812']);
  assert.deepEqual(t(pr('fixes: #812')), ['fixes:acme/widget#812:fixes: #812']);
  assert.deepEqual(t(pr('This Closes acme/widget#7 and resolved #8')), ['fixes:acme/widget#7:Closes acme/widget#7', 'fixes:acme/widget#8:resolved #8']);
  assert.deepEqual(t(pr('Fixes https://github.com/acme/widget/issues/9')), ['fixes:acme/widget#9:Fixes https://github.com/acme/widget/issues/9']);
  assert.deepEqual(t(pr('related to #812, see also #813, mentions #814')), ['references:acme/widget#812:#812', 'references:acme/widget#813:#813', 'references:acme/widget#814:#814']);
  assert.deepEqual(t(iss('Fixes #812')), ['references:acme/widget#812:Fixes #812'], 'an issue cannot close another issue');
  assert.deepEqual(t(pr('<!-- Fixes #123 -->\n```\nfixes #55\n```\nUse `closes #66` in your PR. &#39; prefix#5 a#6')), [], 'comments, code and entities are not links');
  assert.deepEqual(t(pr('Fixes other/repo#3')), ['fixes:other/repo#3:Fixes other/repo#3']);
  // Offsets are into the original text.
  const body = 'Intro 👋🏽\r\nFixes #812';
  const [r] = parseReferences(pr(body), 'acme/widget');
  assert.equal(body.slice(r.start, r.end), 'Fixes #812');
});

test('scenario 5: "Fixes #713" gives a fixes edge and the tier; "related to #702" only a references edge, no inheritance', () => {
  const { snapshot, graph } = v32();
  const pull = snapshot.items.find((i) => i.localId === '#716');
  const edges = graph.edges.filter((e) => e.from === pull.id && (e.type === 'fixes' || e.type === 'references'));
  assert.deepEqual(edges.map((e) => `${e.type}->${e.to}`).sort(), ['fixes->github:acme/widget:issue:713', 'references->github:acme/widget:issue:702']);
  assert.equal(pull.effectiveTier, 'T1');
  assert.deepEqual(pull.ruleIds, ['PR-FIXES-URGENT']);
  const inh = snapshot.evidence.filter((e) => e.itemId === pull.id && e.kind === 'inherited_link');
  assert.deepEqual(inh.map((e) => [e.text, e.linked]), [['Fixes #713', ['#713']]], 'only the fixed issue is inherited from');
  for (const e of edges) for (const q of e.quotes) assert.equal(pull.text.body.slice(q.start, q.end), q.text);
});

test('scenario 6: a generic "timeout" is not a duplicate; error-code-specific duplicates are suggested', () => {
  const snap = snapshotFromFile(DEV);
  const res = candidateLinks(snap);
  const local = new Map(snap.items.map((i) => [i.id, i.localId]));
  const pairs = res.edges.map((e) => [local.get(e.from), local.get(e.to)].sort().join('~'));
  assert.ok(!pairs.includes('d-n1a~d-n1b'), 'timeout pair not linked');
  assert.ok(!pairs.includes('d-n2a~d-n2b'), 'same ENOENT, different cause: not linked');
  assert.ok(pairs.includes('d-p9a~d-p9b'), 'SIGSEGV duplicate linked');
  assert.ok(pairs.includes('d-p6a~d-p6b'), 'ERR_OSSL duplicate linked');
});

test('scenario 3: "no data loss" does not raise, and its pairing with an affirmative data-loss report is suppressed as conflicting', () => {
  const snap = snapshotFromFile(DEV);
  const c1b = snap.items.find((i) => i.localId === 'd-c1b');
  assert.equal(c1b.effectiveTier, 'T3');
  assert.ok(c1b.suppressed.some((s) => s.ruleId === 'DATA-LOSS' && s.context === 'negated'));
  const res = candidateLinks(snap, { thresholds: { possible_duplicate: 0.3, same_symptom: 0.25 } });
  const local = new Map(snap.items.map((i) => [i.id, i.localId]));
  const sup = res.suppressed.map((s) => [local.get(s.from), local.get(s.to)].sort().join('~'));
  assert.ok(sup.includes('d-c1a~d-c1b'), 'data loss vs no data loss suppressed at a permissive threshold');
  const s = res.suppressed.find((x) => [local.get(x.from), local.get(x.to)].sort().join('~') === 'd-c1a~d-c1b');
  assert.equal(s.reason, 'conflicting_evidence');
  assert.ok(s.conflicts.some((c) => c.ruleId === 'DATA-LOSS' && c.negated.text === 'data loss'));
  assert.ok(!res.edges.some((e) => [local.get(e.from), local.get(e.to)].sort().join('~') === 'd-c1a~d-c1b'));
  // "cannot rule out data loss" follows the existing suspicion semantics: it raises.
  const sus = snapFromRows([{ id: 's1', title: 'Sync conflict', text: { body: 'We cannot rule out data loss after the sync conflict.' } }]);
  assert.equal(sus.items[0].effectiveTier, 'T1');
  assert.equal(sus.evidence[0].context, 'suspected');
});

test('template noise: items that share only a long template are never linked', () => {
  const tpl = '### Before you start\n- [ ] I searched the existing issues and discussions\n- [ ] I am using the latest release of the app on my machine\n- [ ] I read the contributing guide and the code of conduct\n### Environment details for this report\nOperating system name and version number here\n### What happened\n';
  const rows = ['Add tags to notes', 'Toolbar cut off at 150%', 'EPUB export', 'API rate limits?', 'Calendar view'].map((t, i) => ({ id: `m${i}`, title: t, text: { body: `${tpl}${['tags please', 'icons cut off', 'ebook export', 'limits for requests', 'month view'][i]}` } }));
  const snap = snapFromRows(rows);
  const res = candidateLinks(snap, { thresholds: { possible_duplicate: 0.2, same_symptom: 0.1 } });
  assert.deepEqual(res.edges, []);
});

test('hard negative with identical vocabulary is not linked; the long report with a buried duplicate is reported as missed (known limit)', () => {
  const r = computeLinkResults().dev.shipped;
  assert.ok(!r.false_links.some((f) => f.a === 'd-n6a'), 'dark mode feature vs bug not linked');
  assert.ok(r.missed_pairs.some((m) => m.a === 'd-p3a' && m.b === 'd-p3b'), 'the buried duplicate is a counted miss, never hidden');
});

test('the candidate-link benchmark reproduces bench/maintainer-radar/results.json', () => {
  const published = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench', 'maintainer-radar', 'results.json'), 'utf8'));
  assert.deepEqual(computeLinkResults(), published);
  // Shipped thresholds: zero false links on both sets, and both settings are published.
  assert.equal(published.dev.shipped.false_links.length, 0);
  assert.equal(published.heldout.shipped.false_links.length, 0);
  assert.deepEqual(published.dev.brief.thresholds, { possible_duplicate: 0.72, same_symptom: 0.5 });
});

test('property: the edge set is independent of input order (seeded permutations), while board order follows the input', () => {
  const rows = fs.readFileSync(DEV, 'utf8').trim().split('\n').map(JSON.parse);
  const base = buildGraph(snapFromRows(rows));
  const sig = (g) => JSON.stringify({ edges: g.edges, clusters: g.clusters, suppressed: g.suppressedCandidates, nodes: g.nodes.filter((n) => n.type !== 'evidence') });
  const rand = seededRandom(42);
  for (let k = 0; k < 4; k++) {
    const shuffled = [...rows];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const snap = snapFromRows(shuffled);
    const g = buildGraph(snap);
    assert.equal(sig(g), sig(base), `permutation ${k}`);
    assert.deepEqual(snap.items.map((i) => i.localId), shuffled.map((r) => r.id), 'snapshot keeps the input order');
  }
});

test('property: every graph validates, direct edges cite provable sources, the graph never assigns priority, building it changes nothing', () => {
  for (const snap of [snapshotFromFile(DEV), v32().snapshot]) {
    const before = JSON.stringify(snap);
    const g = buildGraph(snap);
    assert.equal(JSON.stringify(snap), before, 'snapshot untouched');
    assert.deepEqual(validateGraph(g, snap), []);
    assert.ok(!/"(?:tier|effectiveTier|priority)"/.test(JSON.stringify(g)), 'no priority anywhere in the graph');
    for (const e of g.edges) assert.equal(e.id, edgeId(e.type, e.from, e.to, e.algorithm));
    assert.equal(JSON.stringify(buildGraph(snap)), JSON.stringify(g), 'repeat build is identical');
    // Every item stays a node: nothing is merged away.
    for (const si of snap.items) assert.ok(g.nodes.some((n) => n.id === si.id));
  }
});

test('property: links never change tiers; both members of a possible duplicate keep their tier and place', () => {
  const { snapshot, graph } = v32();
  const cand = graph.edges.filter((e) => e.certainty === 'candidate');
  assert.ok(cand.length >= 2, 'the installer reports are linked');
  const byId = new Map(snapshot.items.map((i) => [i.id, i]));
  for (const e of cand) {
    assert.equal(byId.get(e.from).effectiveTier, 'T1');
    assert.equal(byId.get(e.to).effectiveTier, 'T1');
  }
  assert.deepEqual(validateGraph(graph, snapshot), []);
});

test('hard caps: at most 5 candidate links per item; clusters are stars, never transitive closures', () => {
  const rows = [];
  for (let i = 0; i < 9; i++) rows.push({ id: `c${i}`, title: `Renderer panics with ERR_GPU_LOST on Vulkan ${i}`, text: { body: `The renderer panics with ERR_GPU_LOST when the Vulkan backend resumes after suspend on driver ${i}.` } });
  // A burst of nine near-identical reports inside a queue of 40 unrelated ones.
  const topics = ['tags', 'fonts', 'calendar', 'printing', 'search', 'themes', 'export', 'backup', 'proxy', 'webhooks'];
  for (let i = 0; i < 40; i++) rows.push({ id: `bg${i}`, title: `Question about ${topics[i % 10]} number ${i}`, text: { body: `How do I configure ${topics[(i * 3) % 10]} for team ${i}?` } });
  const snap = snapFromRows(rows);
  const g = buildGraph(snap);
  const deg = new Map();
  for (const e of g.edges.filter((x) => x.certainty === 'candidate')) for (const x of [e.from, e.to]) deg.set(x, (deg.get(x) || 0) + 1);
  assert.ok(deg.size > 0);
  for (const [, d] of deg) assert.ok(d <= LIMITS.MAX_LINKS, `degree ${d}`);
  assert.ok(g.stats.droppedByCap > 0, 'the cap was exercised');
  assert.deepEqual(validateGraph(g, snap), []);
  for (const c of g.clusters) for (const m of c.members) assert.ok(g.edges.some((e) => e.id === m.edge && [e.from, e.to].includes(c.anchor)));
});

test('links prints related reports as candidates, with the quote of every direct link, and --json is the validated graph', () => {
  const out = path.join(tmpDir(), 'snap');
  const env = { env: { URGENT_FIRST_GITHUB_FIXTURE: V32, URGENT_FIRST_CACHE: tmpDir('uf-cache-') } };
  assert.equal(runCli(['snapshot', 'github', 'acme/widget', '--out', out], env).code, 0);
  const r = runCli(['links', out]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /fixes +#716 .* -> #713 .*quote "Fixes #713"/);
  assert.match(r.stdout, /may describe the same problem/);
  assert.match(r.stdout, /not a probability/);
  assert.ok(!/duplicate of|is a duplicate/i.test(r.stdout));
  const j = runCli(['links', out, '--json']);
  assert.equal(j.code, 0);
  const g = JSON.parse(j.stdout);
  assert.equal(g.kind, 'urgent-first-evidence-graph');
  assert.equal(fs.readFileSync(path.join(out, 'evidence-graph.json'), 'utf8').trim(), j.stdout.trim());
  assert.deepEqual(g.thresholds, { ...THRESHOLDS });
});

test('performance: 2,000 synthetic issues snapshot and link in bounded time with bounded comparisons', () => {
  const rows = [];
  const words = ['sync', 'export', 'login', 'theme', 'search', 'plugin', 'installer', 'editor', 'sidebar', 'canvas', 'proxy', 'webhook', 'calendar', 'backup', 'printer', 'font'];
  const rand = seededRandom(7);
  const pick = () => words[Math.floor(rand() * words.length)];
  for (let i = 0; i < 2000; i++) rows.push({ id: `p${i}`, title: `${pick()} ${pick()} problem ${i % 50}`, text: { body: `When I use the ${pick()} with the ${pick()} it fails with E${1000 + (i % 300)}. ${pick()} ${pick()} ${pick()}.` } });
  const t0 = Date.now();
  const snap = snapFromRows(rows);
  const g = buildGraph(snap);
  const ms = Date.now() - t0;
  assert.ok(ms < 30000, `took ${ms} ms`);
  assert.ok(g.stats.comparisons <= rows.length * LIMITS.MAX_CANDIDATES, 'bounded candidate work');
  assert.deepEqual(validateGraph(g, snap), []);
});

test('the README candidate-link table equals bench/maintainer-radar/results.json', () => {
  const published = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench', 'maintainer-radar', 'results.json'), 'utf8'));
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const [split, setting] of [['dev', 'shipped'], ['heldout', 'shipped'], ['dev', 'brief'], ['heldout', 'brief']]) {
    const r = published[split][setting];
    const row = `| ${r.predicted_links} | ${r.true_links} | ${r.true_links} of ${r.predicted_links} | ${r.true_links} of ${r.positive_pairs} |`;
    assert.ok(readme.includes(row), `${split} ${setting}: ${row}`);
  }
});
