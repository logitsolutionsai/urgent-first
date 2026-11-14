import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadItems } from '../src/adapters/index.js';
import { fetchIssues, parseRepo, nextLink, issueToRawItem } from '../src/adapters/github.js';
import { fixtureFetch } from '../src/adapters/github-fixture.js';
import { normalizeItems } from '../src/items.js';
import { parseCsv } from '../src/adapters/csv.js';
import { hl7ToRawItems } from '../src/adapters/hl7v2.js';
import { ROOT } from './helpers.js';

const FX = path.join(ROOT, 'tests', 'fixtures');

test('JSONL adapter reads the documented schema and rejects bad items with a precise message', () => {
  const { items } = loadItems(path.join(ROOT, 'bench', 'radiology-research', 'dev.jsonl'));
  assert.ok(items.length > 100);
  const it = items[0];
  for (const k of ['id', 'title', 'text', 'priority', 'labels', 'created_at', 'location', 'metadata', 'synthetic']) assert.ok(k in it, k);
  assert.throws(() => normalizeItems([{ title: 'no id' }]), /missing id/);
  assert.throws(() => normalizeItems([{ id: 'a', text: { Body: 'x' } }]), /must be lowercase/);
  assert.throws(() => normalizeItems([{ id: 'a', created_at: 'yesterday' }]), /not an ISO 8601/);
  assert.throws(() => normalizeItems([{ id: 'a' }, { id: 'a' }]), /Duplicate id "a"/);
});

test('CSV adapter handles quoting, named text fields, labels and metadata', () => {
  assert.deepEqual(parseCsv('a,b\n"x, ""y""",2\n'), [['a', 'b'], ['x, "y"', '2']]);
  const { items, formats } = loadItems(path.join(FX, 'tickets.csv'));
  assert.deepEqual(formats, ['csv']);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0].labels, ['support', 'billing']);
  assert.equal(items[0].metadata.customer_tier, 'enterprise');
  assert.equal(items[1].text.body, 'Is there a way to export all notes as Markdown, "including attachments"?');
  assert.equal(items[0].gold.tier, 'T1');
});

test('FHIR R4 adapter maps ServiceRequest fields, encounter class and the synthetic tag', () => {
  const { items, warnings } = loadItems(path.join(FX, 'orders.fhir.json'));
  assert.equal(items.length, 3, 'completed requests are skipped');
  assert.match(warnings[0], /skipped 1 ServiceRequest/);
  const a = items.find((i) => i.id === 'fx-001');
  assert.equal(a.title, 'CT head without contrast');
  assert.equal(a.priority, 'routine');
  assert.equal(a.location, 'ED');
  assert.equal(a.text.reason, 'Sudden R arm weakness and slurred speech. LKW 07:40.');
  assert.equal(a.text.note, 'Patient on aspirin only.');
  assert.equal(a.synthetic, true, 'bundle meta.security HTEST marks synthetic data');
  assert.equal(items.find((i) => i.id === 'fx-003').title, 'CT pulmonary angiogram', 'code.coding display when no text');
  assert.equal(items.find((i) => i.id === 'fx-002').location, 'outpatient');
});

test('HL7 v2 adapter reads TQ1-9 first and falls back to OBR-27.6 with a warning', () => {
  const { items, warnings } = loadItems(path.join(FX, 'orders.hl7'));
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId['HL7-001'].priority, 'stat', 'v2.5.1 STAT lives in TQ1-9 while OBR-27 is empty');
  assert.equal(byId['HL7-001'].metadata.priority_source, 'TQ1-9');
  assert.equal(byId['HL7-001'].text.reason, 'Sudden L facial droop and L arm weakness. LKW 0830.');
  assert.equal(byId['HL7-001'].text.history, 'Known AF on apixaban.');
  assert.equal(byId['HL7-001'].text.note, 'Please call ext 4410 with the result.');
  assert.equal(byId['HL7-001'].location, 'ED');
  assert.equal(byId['HL7-001'].created_at, '2026-04-07T09:10:00Z');
  assert.equal(byId['HL7-001'].synthetic, true, 'MSH-11 T marks training data');
  assert.equal(byId['HL7-002'].priority, 'routine');
  assert.equal(byId['HL7-002'].metadata.priority_source, 'OBR-27.6');
  assert.equal(byId['HL7-003'].priority, 'stat');
  assert.equal(byId['HL7-003'].location, 'inpatient');
  assert.ok(warnings.some((w) => /HL7-002: v2.5.1 message without TQ1-9/.test(w)));
  assert.ok(!warnings.some((w) => /HL7-003/.test(w)), 'v2.3 has no TQ1, so no warning');
  const noPriority = hl7ToRawItems('MSH|^~\\&|A|B|C|D|20260101000000||ORM^O01|1|P|2.5.1\rORC|NW|X1\rOBR|1|X1||^CT head\r');
  assert.equal(noPriority.items[0].priority, null, 'a missing priority stays missing');
});

test('GitHub adapter turns a recorded API response into items', async () => {
  const fetchImpl = fixtureFetch(path.join(FX, 'github'));
  const r = await fetchIssues({ owner: 'acme', repo: 'widget', fetchImpl });
  assert.equal(r.rawItems.length, 10);
  assert.equal(r.etag, 'W/"synthetic-etag-1"');
  assert.equal(r.release.tag, 'v3.2.0');
  const items = normalizeItems(r.rawItems);
  const i812 = items.find((i) => i.id === '#812');
  assert.equal(i812.title, 'Data loss after upgrade to 3.2');
  assert.equal(i812.url, 'https://github.com/acme/widget/issues/812');
  assert.equal(i812.metadata.reactions, 14);
  assert.equal(i812.metadata.comments, 6);
  assert.equal(i812.metadata.latest_release, 'v3.2.0');
  assert.equal(i812.metadata.after_latest_release, true);
  assert.deepEqual(i812.metadata.latest_release_aliases.sort(), ['3.2', '3.2.0', 'v3.2', 'v3.2.0']);
  assert.equal(items.find((i) => i.id === '#818').metadata.type, 'pull_request');
  assert.equal(fetchImpl.calls[0].headers['X-GitHub-Api-Version'], '2022-11-28');
});

test('GitHub adapter sends a token when set and uses ETags: an unchanged list costs a 304', async () => {
  const fetchImpl = fixtureFetch(path.join(FX, 'github'));
  const first = await fetchIssues({ owner: 'acme', repo: 'widget', fetchImpl, token: 'test-token' });
  assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bearer test-token');
  const second = await fetchIssues({ owner: 'acme', repo: 'widget', fetchImpl, etag: first.etag, includeRelease: false });
  assert.equal(second.notModified, true);
  assert.equal(fetchImpl.calls.at(-1).headers['If-None-Match'], 'W/"synthetic-etag-1"');
});

test('GitHub helpers: repo parsing and Link header pagination', () => {
  assert.deepEqual(parseRepo('acme/widget'), { owner: 'acme', repo: 'widget' });
  assert.deepEqual(parseRepo('https://github.com/acme/widget.git'), { owner: 'acme', repo: 'widget' });
  assert.throws(() => parseRepo('acme'), /owner\/repo/);
  const link = '<https://api.github.com/repositories/1/issues?page=2>; rel="next", <https://api.github.com/repositories/1/issues?page=9>; rel="last"';
  assert.equal(nextLink(link), 'https://api.github.com/repositories/1/issues?page=2');
  assert.equal(nextLink('<https://evil.example/x>; rel="next"'), null, 'only follows api.github.com');
  const raw = issueToRawItem({ number: 5, title: 't', body: null, labels: ['a', { name: 'b' }], html_url: 'u' }, { owner: 'o', repo: 'r' });
  assert.deepEqual(raw.labels, ['a', 'b']);
  assert.equal(raw.text.body, '');
});

test('optional live smoke test against the real GitHub API (URGENT_FIRST_LIVE=1)', { skip: process.env.URGENT_FIRST_LIVE !== '1' }, async () => {
  const r = await fetchIssues({ owner: 'octocat', repo: 'Hello-World', limit: 5 });
  assert.ok(Array.isArray(r.rawItems));
  assert.ok(r.rawItems.length <= 5);
});
