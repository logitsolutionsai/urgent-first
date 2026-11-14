// Template and boilerplate masking, pull requests inheriting the tier of the issue they fix, bench-fetch and the
// flag precision maths. All items here are invented; no real issue text is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPack, compilePack } from '../src/pack.js';
import { normalizeItems } from '../src/items.js';
import { triage } from '../src/engine.js';
import { computeMasks, templateFileLines, lineKey, applyMask } from '../src/mask.js';
import { flagMetrics, evaluateLabelled } from '../src/eval.js';
import { benchFetch, readIds, benchItem, writeBenchOutput } from '../src/benchfetch.js';
import { missingLinkedNumbers, fetchTemplates } from '../src/adapters/github-extra.js';
import { renderHtml } from '../src/render/html.js';
import { renderMarkdown } from '../src/render/markdown.js';
import { tmpDir, runCli } from './helpers.js';

const gh = loadPack('github-maintainer');
const SRC = 'github:acme/widget';

const BUG_FORM = `name: Bug report
description: Something is broken
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to fill out this bug report.
  - type: textarea
    attributes:
      label: Does this crash on startup or corrupt any data?
      description: Tell us if the app crashed or your data was lost.
  - type: dropdown
    attributes:
      label: Severity
      options:
        - Data loss
        - Minor
  - type: checkboxes
    attributes:
      label: Checklist
      options:
        - label: I searched for existing security issues first
          required: true
`;
const PR_TEMPLATE = `## Checklist
- [ ] Final diff reviewed for security
- [ ] Tests pass, no regression
**Version used**:
- [ ] Hotfix for a production outage
`;
const TEMPLATES = { [SRC]: [{ path: '.github/ISSUE_TEMPLATE/bug.yml', content: BUG_FORM }, { path: '.github/pull_request_template.md', content: PR_TEMPLATE }] };

function issue(n, body, extra = {}) {
  return { id: `#${n}`, title: extra.title || `Issue ${n}`, text: { body }, source: SRC, metadata: { type: extra.type || 'issue', number: n }, ...(extra.labels ? { labels: extra.labels } : {}) };
}

function run(raw, opts = {}) {
  return triage(normalizeItems(raw), opts.pack || gh, { templates: opts.templates === undefined ? TEMPLATES : opts.templates, linked: opts.linked || null });
}

const byId = (res) => Object.fromEntries(res.items.map((r) => [r.id, r]));

// ---------- template lines ----------

test('issue-form templates give labels, descriptions, values and checkbox labels, never dropdown options', () => {
  const lines = templateFileLines('bug.yml', BUG_FORM).map(lineKey);
  assert.ok(lines.includes('thanks for taking the time to fill out this bug report'));
  assert.ok(lines.includes('does this crash on startup or corrupt any data'));
  assert.ok(lines.includes('tell us if the app crashed or your data was lost'));
  assert.ok(lines.includes('i searched for existing security issues first'));
  assert.ok(!lines.includes('data loss'), 'a dropdown option is the reporter\'s answer, not template text');
  const md = templateFileLines('pull_request_template.md', `---\nname: PR\nabout: x\n---\n${PR_TEMPLATE}`).map(lineKey);
  assert.ok(md.includes('final diff reviewed for security'));
  assert.ok(!md.some((l) => l.startsWith('name')), 'front matter is not template text');
});

test('line keys ignore markdown decoration, checkbox state, case, digits and hashes', () => {
  assert.equal(lineKey('- [x] Final diff reviewed for security'), lineKey('* [ ] final diff reviewed  for security'));
  assert.equal(lineKey('### Does this crash on startup or corrupt any data?'), 'does this crash on startup or corrupt any data');
  assert.equal(lineKey('VS Code version: 1.95.3 (f1a4fb10, 2024-11-13)'), lineKey('VS Code version: 1.96.0 (9a8b7c6d, 2025-01-02)'));
});

test('template masking: prompts, headings and checklists are not read; the reporter\'s answer is; offsets stay exact', () => {
  const body = '### Does this crash on startup or corrupt any data?\n\nNo, it just shows the wrong colour.\n\n### Checklist\n\n- [X] I searched for existing security issues first';
  const res = run([issue(1, body)]);
  const r = res.items[0];
  assert.equal(r.tier, 'T3', `template text raised it: ${r.explanation}`);
  assert.ok(r.masked.every((m) => m.kind === 'template'));
  const texts = r.masked.map((m) => body.slice(m.start, m.end));
  assert.ok(texts.includes('### Does this crash on startup or corrupt any data?'));
  assert.ok(!texts.some((t) => t.includes('wrong colour')));
  // Without the templates the same item is flagged on the template's words: the masking is what changed it.
  assert.notEqual(run([issue(1, body)], { templates: null }).items[0].tier, 'T3');
  // A reporter's own sentence under the masked heading still counts.
  const real = '### Does this crash on startup or corrupt any data?\n\nYes: after the update every project file is gone and the trash is empty.';
  const rr = run([issue(2, real)]).items[0];
  assert.equal(rr.tier, 'T1');
  for (const rule of rr.rules) for (const e of rule.evidence) assert.equal(real.slice(e.start, e.end), e.text);
});

test('template prefix: only the prompt is masked, the answer after it stays readable', () => {
  const body = '**Version used**: 3.2.0, and every save corrupts the file';
  const r = run([issue(3, body)]).items[0];
  const m = r.masked.find((x) => x.kind === 'template');
  assert.ok(m, 'prefix masked');
  assert.equal(body.slice(m.start, m.end), '**Version used');
  assert.ok(r.rules.some((x) => x.id === 'DATA-LOSS'), 'the answer after the prompt is still read');
});

// ---------- boilerplate ----------

function boilerplateBatch(n, line, extra = []) {
  const raw = [];
  const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima'];
  for (let i = 1; i <= n; i++) raw.push(issue(100 + i, `Report ${words[i - 1]}: the sidebar colour looks odd.\n${line}`));
  return [...raw, ...extra];
}

test('boilerplate: a line in at least min_share of the items of one kind is masked; below the threshold it is read', () => {
  const line = 'Diagnostics footer: the helper process crashes when the footer opens';
  // CRASH-OR-HANG (T2) would fire on every item; T2 lines are not protected, so the footer is masked.
  const res = run(boilerplateBatch(10, line), { templates: null });
  assert.equal(res.counts.flagged, 0, 'the repeated footer flagged nothing');
  assert.equal(res.masking.boilerplate_lines_masked, 10);
  for (const r of res.items) assert.equal(r.masked[0].kind, 'boilerplate');
  // Four items with the same line out of 25 (16% < 20%, and fewer than min_items 5): not boilerplate, still read.
  const few = boilerplateBatch(4, line, Array.from({ length: 21 }, (_, i) => issue(300 + i, `Other report ${'abcdefghijklmnopqrstu'[i]}x about menus`)));
  const res2 = run(few, { templates: null });
  assert.equal(res2.masking.boilerplate_lines_masked, 0);
  assert.equal(res2.items.filter((r) => r.tier !== 'T3').length, 4);
});

test('boilerplate never hides a top-tier cue: a T1 sentence repeated across many items stays readable', () => {
  const t1 = 'After the update every project file is gone and the trash is empty.';
  const res = run(boilerplateBatch(10, t1), { templates: null });
  assert.equal(res.masking.kept_top_tier_lines ?? res.masking.boilerplate.kept_top_tier_lines, 1);
  for (const r of res.items) {
    assert.equal(r.tier, 'T1', `${r.id} lost its T1 cue`);
    assert.ok(!r.masked, 'the T1 line was not masked');
  }
});

test('boilerplate counts per kind: a pull request checklist line is judged among pull requests only', () => {
  const prs = Array.from({ length: 6 }, (_, i) => issue(500 + i, `Change ${'abcdef'[i]}z\n- [x] I ran the crash reproduction script locally`, { type: 'pull_request' }));
  const issues = Array.from({ length: 30 }, (_, i) => issue(600 + i, `Question ${'abcdefghijklmnopqrstuvwxyzABCD'[i]}q about the docs`));
  const res = run([...prs, ...issues], { templates: null });
  for (const r of res.items.filter((x) => x.id.startsWith('#5'))) assert.equal(r.masked?.[0]?.kind, 'boilerplate', r.id);
});

test('research mode never masks, and titles are never masked', () => {
  const research = loadPack('radiology-research');
  const masks = computeMasks(normalizeItems(Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, title: 'same', text: { reason: 'Same line everywhere' }, synthetic: true, priority: 'routine' }))), research, {});
  assert.equal(masks.summary, null);
  assert.equal(masks.masks.size, 0);
  const res = run(Array.from({ length: 8 }, (_, i) => ({ ...issue(700 + i, `Body ${i}`), title: 'Every file deleted after sync' })), { templates: null });
  for (const r of res.items) assert.equal(r.tier, 'T1', 'the shared title is still read');
});

test('a pack without "masking" masks nothing (oncall), and applyMask keeps length and newlines', () => {
  const oc = loadPack('oncall');
  assert.equal(computeMasks(normalizeItems(Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, text: { body: 'Same footer line here' } }))), oc, {}).summary, null);
  const t = 'abc\ndef\nghi';
  const m = applyMask(t, [{ start: 2, end: 6 }]);
  assert.equal(m.length, t.length);
  assert.equal(m, 'ab \n  f\nghi');
});

test('the board shows masked text dimmed and labelled, and explain lists it', () => {
  const body = '### Does this crash on startup or corrupt any data?\n\nYes: every project file is gone after the update.';
  const items = normalizeItems([issue(9, body)]);
  const res = triage(items, gh, { templates: TEMPLATES });
  const html = renderHtml(res, { pack: gh, itemsById: new Map(items.map((i) => [i.id, i])) });
  assert.match(html, /<span class="masked" title="template text, not read by rules" data-masked="0-51">### Does this crash on startup or corrupt any data\?<\/span>/);
  assert.match(html, /dimmed: template text, not read by rules/);
  assert.match(html, /id="masking"/);
  const md = renderMarkdown(res, { pack: gh });
  assert.match(md, /Masked: 1 line\(s\) of template text, not read by rules/);
  // explain <run> --item
  const dir = tmpDir('uf-mask-');
  const src = path.join(dir, 'items.jsonl');
  fs.writeFileSync(src, JSON.stringify({ ...issue(9, body), source: 'github:acme/widget' }) + '\n');
  const out = path.join(dir, 'run');
  assert.equal(runCli(['run', 'github-maintainer', src, '--out', out]).code, 0);
  const e = runCli(['explain', out, '--item', '#9']);
  assert.equal(e.code, 0, e.stderr);
  assert.match(e.stdout, /Masked: nothing|Masked \(template text, not read by rules\)/);
  const e2 = runCli(['explain', 'github-maintainer', 'every file is gone']);
  assert.match(e2.stdout, /Masking: this pack masks repository-template lines/);
});

// ---------- pull requests inherit ----------

test('a pull request that says "Fixes #N" takes the tier of issue #N, quoting the "Fixes #N" span', () => {
  const raw = [
    issue(10, 'Since 3.2.0 every sync deletes my project folder.', { title: 'Sync deletes project folder' }),
    issue(11, 'The sidebar is a bit narrow.', { title: 'Sidebar width' }),
    issue(20, 'Restore the folder on conflict.\n\nFixes #10', { type: 'pull_request', title: 'sync: keep folder on conflict' }),
    issue(21, 'Widen it.\n\nCloses #11', { type: 'pull_request', title: 'Widen sidebar' }),
    issue(22, 'Fixes #999 which is not in this run.', { type: 'pull_request', title: 'Unrelated' }),
  ];
  const res = byId(run(raw, { templates: null }));
  assert.equal(res['#10'].tier, 'T1');
  assert.equal(res['#20'].tier, 'T1');
  const rule = res['#20'].rules.find((x) => x.id === 'PR-FIXES-URGENT');
  assert.equal(rule.evidence[0].text, 'Fixes #10');
  assert.equal(rule.linked[0].id, '#10');
  assert.ok(rule.linked[0].by.includes('DATA-LOSS'));
  assert.match(res['#20'].explanation, /PR-FIXES-URGENT \(T1\) quotes "Fixes #10".*#10 is T1 by DATA-LOSS/);
  assert.equal(res['#21'].tier, 'T3', 'a pull request fixing an unflagged issue is not raised');
  assert.equal(res['#22'].tier, 'T3', 'an issue outside the run (and not fetched) gives nothing');
});

test('inheritance is raise-only, does not chain, and an issue fetched only to resolve a link is not on the board', () => {
  const raw = [
    issue(30, 'Fixes #31', { type: 'pull_request', title: 'pr one' }),
    issue(31, 'Fixes #32', { type: 'pull_request', title: 'pr two' }),
    issue(33, 'Fixes #40\n\nAlso the build is broken on main for everyone.', { type: 'pull_request', title: 'pr three', labels: ['security'] }),
  ];
  const linked = normalizeItems([issue(32, 'Every file in the project is deleted after sync.'), issue(40, 'Typo in the docs.')]);
  const res = byId(run(raw, { templates: null, linked }));
  assert.equal(Object.keys(res).length, 3, 'linked issues are not on the board');
  assert.equal(res['#31'].tier, 'T1', 'fetched issue #32 is T1');
  assert.equal(res['#30'].tier, 'T3', 'links do not chain through #31');
  assert.equal(res['#33'].tier, 'T1', 'the security label floor stays; a T3 link never lowers it');
  assert.equal(missingLinkedNumbers(normalizeItems(raw), gh).join(','), '32,40');
});

test('a pull request\'s own words still raise it through the normal rules, with masking on', () => {
  // github-maintainer's rules read issues only (a pull request describes the bug it fixes); a pack rule that
  // reads pull requests still raises them, and still does not read their template text.
  const raw = JSON.parse(JSON.stringify(gh, (k, v) => (k.startsWith('_') ? undefined : v)));
  raw.rules.push({ id: 'PR-HOTFIX', tier: 'T2', title: 'Hotfix', why: 'w', source: { citation: 'c', url: 'https://example.org' }, match: { all: [{ field: 'metadata.type', equals: 'pull_request' }, { terms: ['hotfix'] }] } });
  const pack = compilePack(raw);
  const own = run([issue(50, 'Hotfix for the login outage.', { type: 'pull_request' })], { pack }).items[0];
  assert.equal(own.tier, 'T2');
  const tpl = run([issue(51, 'Rename a variable.\n- [ ] Hotfix for a production outage', { type: 'pull_request' })], { pack }).items[0];
  assert.equal(tpl.tier, 'T3', 'the unticked template checklist line is masked');
  const res = byId(run([issue(52, 'Every project file is deleted after sync.'), issue(53, 'Hotfix.\n\nFixes #52', { type: 'pull_request' })], { pack }));
  assert.equal(res['#53'].tier, 'T1', 'the most urgent of its own rules and the linked issue');
});

test('the inherit block is checked: a regex without a capture group, or an id that is also a rule, is refused', async () => {
  const { semanticErrors } = await import('../src/pack.js');
  const raw = JSON.parse(JSON.stringify(gh));
  for (const k of Object.keys(raw)) if (k.startsWith('_')) delete raw[k];
  raw.inherit = { ...raw.inherit, regex: 'fixes #\\d+' };
  assert.ok(semanticErrors(raw).some((e) => /capture group/.test(e)));
  raw.inherit = { ...gh.inherit, id: 'SECURITY' };
  assert.ok(semanticErrors(raw).some((e) => /also a rule id/.test(e)));
  void compilePack;
});

// ---------- bench-fetch ----------

function mockApi(responses) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const hit = responses.find(([re]) => re.test(url));
    const status = hit ? hit[1] : 404;
    const body = hit ? hit[2] : { message: 'Not Found' };
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (n) => ({ 'x-ratelimit-remaining': '41' })[n.toLowerCase()] ?? null },
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  impl.calls = calls;
  return impl;
}

const apiIssue = (n, labels, extra = {}) => ({ number: n, title: `Issue ${n}`, body: `Body of ${n}: the app crashes on start.`, labels: labels.map((name) => ({ name })), created_at: '2026-01-01T00:00:00Z', html_url: `https://github.com/acme/widget/issues/${n}`, state: 'closed', milestone: { title: 'release blocker 3.2' }, ...extra });

test('bench-fetch strips every label (and the milestone) before the engine sees an item, and caches responses', async () => {
  const dir = tmpDir('uf-bench-');
  const idsFile = path.join(dir, 'ids.jsonl');
  fs.writeFileSync(idsFile, ['{"ref":"acme/widget#1","gold":"T1","label":"P0"}', '{"ref":"acme/widget#2","gold":"T3","label":"enhancement"}', '{"ref":"acme/widget#3","gold":"T1","label":"P0"}'].join('\n') + '\n');
  const rows = readIds(idsFile);
  const api = mockApi([
    [/labels=P0/, 200, [apiIssue(1, ['P0', 'security', 'regression'])]],
    [/labels=enhancement/, 200, [apiIssue(2, ['enhancement'])]],
    [/\/issues\/3$/, 200, apiIssue(3, ['P0', 'data loss'])],
    [/contents\/\.github\/ISSUE_TEMPLATE/, 200, [{ type: 'file', name: 'bug.yml', path: '.github/ISSUE_TEMPLATE/bug.yml', download_url: 'https://raw.githubusercontent.com/acme/widget/HEAD/.github/ISSUE_TEMPLATE/bug.yml' }]],
    [/raw\.githubusercontent\.com\/acme\/widget\/HEAD\/\.github\/ISSUE_TEMPLATE\/bug\.yml/, 200, BUG_FORM],
  ]);
  const cacheDir = path.join(dir, 'cache');
  const res = await benchFetch({ rows, fetchImpl: api, cacheDir });
  assert.deepEqual(res.missing, []);
  assert.equal(res.items.length, 3);
  for (const it of res.items) {
    assert.deepEqual(it.labels, [], `${it.id} kept labels`);
    assert.ok(!('milestone' in it.metadata), `${it.id} kept its milestone`);
    assert.equal(it.synthetic, false);
    assert.ok(!JSON.stringify(it).includes('"P0"') || it.gold.category === 'label:P0');
  }
  assert.equal(res.items[0].id, 'acme/widget#1');
  assert.equal(res.items[0].gold.tier, 'T1');
  assert.equal(res.items[0].gold.category, 'label:P0');
  assert.equal(res.requests, 4, 'two label lists, one single issue, one template listing');
  assert.equal(res.remaining, 41);
  assert.equal(res.templates['github:acme/widget'][0].path, '.github/ISSUE_TEMPLATE/bug.yml');
  // The engine never sees the labels: the security / P0 / data loss floors do not apply.
  const files = writeBenchOutput(res, path.join(dir, 'out', 'items.jsonl'));
  const rep = evaluateLabelled(normalizeItems(fs.readFileSync(files.itemsFile, 'utf8').trim().split('\n').map(JSON.parse)), gh, { templates: res.templates });
  assert.equal(rep.rules_only.items, 3);
  const r1 = triage(normalizeItems([{ ...res.items[0], gold: undefined }].map(({ gold, ...x }) => x)), gh, {}).items[0];
  assert.deepEqual(r1.floor.reasons, [], 'no label floor');
  // Second run: everything from the cache, no request.
  const again = await benchFetch({ rows, fetchImpl: mockApi([]), cacheDir });
  assert.equal(again.requests, 0);
  assert.equal(again.items.length, 3);
});

test('bench-fetch refuses an ids file with text or other fields, and benchItem never keeps labels', () => {
  const dir = tmpDir('uf-ids-');
  const f = path.join(dir, 'ids.jsonl');
  fs.writeFileSync(f, '{"ref":"acme/widget#1","gold":"T1","label":"P0","title":"leaked text"}\n');
  assert.throws(() => readIds(f), /unexpected field\(s\) title/);
  fs.writeFileSync(f, '{"ref":"acme/../x#1","gold":"T1","label":"P0"}\n');
  assert.throws(() => readIds(f), /owner\/repo#number/);
  const item = benchItem(apiIssue(5, ['P0']), { ref: 'acme/widget#5', owner: 'acme', repo: 'widget', number: 5, gold: 'T1', label: 'P0' });
  assert.deepEqual(item.labels, []);
});

test('templates: one API request per repository, raw files free, failures give no templates and no error', async () => {
  const api = mockApi([[/contents\/\.github\/ISSUE_TEMPLATE/, 500, null]]);
  const t = await fetchTemplates({ owner: 'acme', repo: 'widget', fetchImpl: api, cacheDir: null });
  assert.deepEqual(t.files, []);
  assert.equal(api.calls.filter((u) => u.startsWith('https://api.github.com')).length, 1);
});

// ---------- precision maths ----------

test('flag metrics: precision, recall and false-flag rate with Wilson intervals', () => {
  const pack = gh;
  const result = { items: [
    { id: 'a', tier: 'T1' }, { id: 'b', tier: 'T2' }, { id: 'c', tier: 'T3' }, // urgent: 2 of 3 flagged
    { id: 'd', tier: 'T2' }, { id: 'e', tier: 'T3' }, { id: 'f', tier: 'T3' }, { id: 'g', tier: 'T3' }, // not urgent: 1 of 4 flagged
  ] };
  const gold = new Map([['a', { tier: 'T1' }], ['b', { tier: 'T1' }], ['c', { tier: 'T2' }], ['d', { tier: 'T3' }], ['e', { tier: 'T3' }], ['f', { tier: 'T3' }], ['g', { tier: 'T3' }]]);
  const f = flagMetrics(result, gold, pack);
  assert.deepEqual([f.precision.count, f.precision.total, f.precision.value], [2, 3, 0.6667]);
  assert.deepEqual([f.recall.count, f.recall.total, f.recall.value], [2, 3, 0.6667]);
  assert.deepEqual([f.false_flag_rate.count, f.false_flag_rate.total, f.false_flag_rate.value], [1, 4, 0.25]);
  // Wilson 95% for 2/3: 0.2077 to 0.9385 (references/evaluation.md formula).
  assert.deepEqual(f.precision.wilson95, [0.2077, 0.9385]);
  // Nothing flagged: precision is undefined, not 0 or 100%.
  const none = flagMetrics({ items: [{ id: 'a', tier: 'T3' }] }, new Map([['a', { tier: 'T1' }]]), pack);
  assert.equal(none.precision.value, null);
  assert.equal(none.precision.wilson95, null);
  assert.equal(none.recall.value, 0);
});

test('a "Fixes #N" line is never masked, even when most pull requests carry one', () => {
  const prs = Array.from({ length: 8 }, (_, i) => issue(800 + i, `Change ${'abcdefgh'[i]}y\n\nFixes #${900 + i}`, { type: 'pull_request' }));
  const res = run([...prs, issue(900, 'Every project file is deleted after sync.')], { templates: null });
  for (const r of res.items.filter((x) => x.id !== '#900')) assert.ok(!r.masked, `${r.id} masked its link line`);
  assert.equal(byId(res)['#800'].tier, 'T1');
});
