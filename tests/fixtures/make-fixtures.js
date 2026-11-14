#!/usr/bin/env node
// Builds the test fixtures in tests/fixtures/ from the definitions below. Run: node tests/fixtures/make-fixtures.js
// All content is synthetic. The GitHub files use the exact field layout of the REST API
// (GET /repos/{owner}/{repo}/issues and /releases/latest, API version 2022-11-28), checked against
// a live response on 2026-11-14; the issue text, users and numbers are invented for the fictional acme/widget.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'github');
fs.mkdirSync(OUT, { recursive: true });

const REPO = 'acme/widget';
let id = 3100000000;
function issue({ number, title, body, labels = [], created_at, comments = 0, reactions = 0, pr = false, user = 'synthetic-user' }) {
  id += 7;
  const base = `https://api.github.com/repos/${REPO}`;
  const obj = {
    url: `${base}/issues/${number}`,
    repository_url: base,
    labels_url: `${base}/issues/${number}/labels{/name}`,
    comments_url: `${base}/issues/${number}/comments`,
    events_url: `${base}/issues/${number}/events`,
    html_url: `https://github.com/${REPO}/${pr ? 'pull' : 'issues'}/${number}`,
    id,
    node_id: `I_kwSYNTHETIC${number}`,
    number,
    title,
    user: { login: user, id: 1000 + number, type: 'User', site_admin: false },
    labels: labels.map((name, i) => ({ id: 9000 + i, node_id: `LA_SYN${i}`, url: `${base}/labels/${encodeURIComponent(name)}`, name, color: 'ededed', default: false, description: null })),
    state: 'open',
    locked: false,
    assignees: [],
    milestone: null,
    comments,
    created_at,
    updated_at: created_at,
    closed_at: null,
    assignee: null,
    author_association: 'NONE',
    active_lock_reason: null,
    draft: pr ? false : undefined,
    body,
    closed_by: null,
    reactions: { url: `${base}/issues/${number}/reactions`, total_count: reactions, '+1': reactions, '-1': 0, laugh: 0, hooray: 0, confused: 0, heart: 0, rocket: 0, eyes: 0 },
    timeline_url: `${base}/issues/${number}/timeline`,
    performed_via_github_app: null,
    state_reason: null,
  };
  if (pr) obj.pull_request = { url: `${base}/pulls/${number}`, html_url: `https://github.com/${REPO}/pull/${number}`, diff_url: `https://github.com/${REPO}/pull/${number}.diff`, patch_url: `https://github.com/${REPO}/pull/${number}.patch`, merged_at: null };
  else delete obj.draft;
  return obj;
}

const page1 = [
  issue({ number: 820, title: 'Add a keyboard shortcut to toggle the sidebar', body: 'It would be nice to hide the sidebar with a shortcut, like Ctrl+B in other editors. I use a small laptop screen.', labels: ['enhancement'], created_at: '2026-10-21T09:14:00Z' }),
  issue({ number: 819, title: 'URGENT!!! please add dark mode to the export dialog', body: 'URGENT, this is a blocker for us!!! The export dialog is still white when the app is in dark mode and it hurts my eyes at night.', created_at: '2026-10-20T22:03:00Z' }),
  issue({ number: 818, title: 'docs: fix typo in sync guide', body: 'Fixes "recieve" to "receive" in docs/guide/sync.md. No other changes.', labels: ['documentation'], created_at: '2026-10-20T16:40:00Z', pr: true }),
  issue({ number: 815, title: 'Sync shows "conflict" dialog twice (no data was lost)', body: 'When a conflict happens the dialog appears twice. I picked "Keep both" both times and got the two expected copies, so no data was lost. Just confusing.\n\nwidget 3.2.0, Windows 11', labels: ['bug'], created_at: '2026-10-19T11:25:00Z' }),
  issue({ number: 812, title: 'Data loss after upgrade to 3.2', body: '### Describe the bug\nAfter upgrading from 3.1.5 to 3.2.0 and restarting, I lost all my saved projects. The projects folder is empty and the trash is empty too.\n\n### Version\n3.2.0 on macOS 15', labels: ['bug'], created_at: '2026-10-18T08:02:00Z', comments: 6, reactions: 14 }),
  issue({ number: 805, title: 'Login loop after updating to 3.2.0', body: 'After updating to 3.2.0 the desktop app keeps showing the sign-in screen. I sign in, the browser says done, and the app shows the sign-in screen again. Forever. Worked fine on 3.1.5. Cannot get to my local projects at all.', labels: [], created_at: '2026-10-16T14:47:00Z', comments: 3, reactions: 9 }),
  issue({ number: 801, title: 'Question: can I self-host the sync server?', body: 'Our organisation cannot put project data on a third-party cloud. Is the sync server available to self-host?', labels: ['question'], created_at: '2026-10-15T10:10:00Z' }),
  issue({ number: 799, title: 'Share links can read other users\' tokens', body: 'While testing share links I noticed that `/s/<id>/meta` returns the owner\'s session record. With two of my own accounts I confirmed that anyone with a share link can read other users\' tokens, and with the token you can open all their projects.\n\nI have not posted details anywhere else.', labels: [], created_at: '2026-10-14T19:31:00Z', comments: 1 }),
  issue({ number: 797, title: 'Crash when I paste an emoji in the project title', body: 'When I paste an emoji in the project title the app closes itself. The project is fine after reopening.\n\nwidget 3.1.5, Windows 10', labels: ['bug'], created_at: '2026-10-13T07:55:00Z' }),
  issue({ number: 790, title: 'main does not build since #786', body: 'Fresh clone of main, `make build` fails:\n\n```\nerror[E0432]: unresolved import `crate::sync::engine::Planner`\n```\nCI on main has been red since that merge.', labels: [], created_at: '2026-10-11T12:00:00Z' }),
];
const release = {
  url: `https://api.github.com/repos/${REPO}/releases/1001`,
  html_url: `https://github.com/${REPO}/releases/tag/v3.2.0`,
  id: 1001,
  tag_name: 'v3.2.0',
  target_commitish: 'main',
  name: 'widget 3.2.0',
  draft: false,
  prerelease: false,
  created_at: '2026-09-09T10:00:00Z',
  published_at: '2026-09-09T10:30:00Z',
  body: 'Synthetic release notes for the fixture.',
};
const page1b = [
  ...page1,
  issue({ number: 826, title: 'Since 3.2.0 every export to PDF fails', body: 'After updating to 3.2.0, every export to PDF fails with "renderer exited". Worked fine on 3.1.5. Our whole team exports reports daily and nothing works.', labels: [], created_at: '2026-10-22T08:30:00Z', comments: 0, reactions: 2 }),
];
fs.writeFileSync(path.join(OUT, 'issues-page1.json'), JSON.stringify(page1, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'issues-page1-new.json'), JSON.stringify(page1b.sort((a, b) => b.number - a.number), null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'release-latest.json'), JSON.stringify(release, null, 2) + '\n');
const index = {
  'GET /repos/acme/widget/issues*': { status: 200, file: 'issues-page1.json', etag: 'W/"synthetic-etag-1"', headers: { 'x-ratelimit-remaining': '58', 'x-ratelimit-reset': '1794700000' } },
  'GET /repos/acme/widget/releases/latest': { status: 200, file: 'release-latest.json', headers: { 'x-ratelimit-remaining': '57' } },
};
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
const OUT2 = path.join(HERE, 'github-updated');
fs.mkdirSync(OUT2, { recursive: true });
fs.copyFileSync(path.join(OUT, 'release-latest.json'), path.join(OUT2, 'release-latest.json'));
fs.copyFileSync(path.join(OUT, 'issues-page1-new.json'), path.join(OUT2, 'issues-page1.json'));
fs.writeFileSync(
  path.join(OUT2, 'index.json'),
  JSON.stringify({ ...index, 'GET /repos/acme/widget/issues*': { ...index['GET /repos/acme/widget/issues*'], etag: 'W/"synthetic-etag-2"' } }, null, 2) + '\n',
);
fs.unlinkSync(path.join(OUT, 'issues-page1-new.json'));
console.log('fixtures written');

// HL7 v2 orders. Message 1 is v2.5.1 with the priority only in TQ1-9 (the trap: OBR-27 is empty).
// Message 2 is v2.5.1 without TQ1 (priority only in OBR-27.6, the adapter warns). Message 3 is v2.3 (OBR-27.6).
function obr({ placer, title, ts, history, timing = '', reason }) {
  const f = new Array(32).fill('');
  f[0] = 'OBR';
  f[1] = '1';
  f[2] = placer;
  f[4] = `^${title}`;
  f[6] = ts;
  f[13] = history;
  f[27] = timing;
  f[31] = reason;
  return f.join('|');
}
const hl7 = [
  String.raw`MSH|^~\&|` + 'SYNTH_RIS|SYNTH_SITE|URGENT_FIRST|TEST|20260407091000||ORM^O01|MSG0001|T|2.5.1',
  'PID|1||SYN-0001^^^SYNTH||SYNTHETIC^PATIENT^A',
  'PV1|1|E|ED^BAY4',
  'ORC|NW|HL7-001||||||||20260407091000',
  obr({ placer: 'HL7-001', title: 'CT head without contrast', ts: '20260407091000', history: 'Known AF on apixaban.', reason: 'Sudden L facial droop and L arm weakness. LKW 0830.' }),
  'TQ1|1||||||||S',
  'NTE|1||Please call ext 4410 with the result.',
  String.raw`MSH|^~\&|` + 'SYNTH_RIS|SYNTH_SITE|URGENT_FIRST|TEST|20260407100000||ORM^O01|MSG0002|T|2.5.1',
  'PID|1||SYN-0002^^^SYNTH||SYNTHETIC^PATIENT^B',
  'PV1|1|O|CLINIC2',
  'ORC|NW|HL7-002||||||||20260407100000',
  obr({ placer: 'HL7-002', title: 'MRI lumbar spine', ts: '20260407100000', history: 'Three months of sciatica.', timing: '^^^^^R', reason: 'Denies saddle anaesthesia or bladder change.' }),
  String.raw`MSH|^~\&|` + 'SYNTH_RIS|SYNTH_SITE|URGENT_FIRST|TEST|20260407103000||OMI^O23|MSG0003|T|2.3',
  'PID|1||SYN-0003^^^SYNTH||SYNTHETIC^PATIENT^C',
  'PV1|1|I|WARD7',
  'ORC|NW|HL7-003||||||||20260407103000',
  obr({ placer: 'HL7-003', title: 'XR chest', ts: '20260407103000', history: 'Line inserted this morning.', timing: '^^^^^S', reason: 'Right subclavian line, now breathless.' }),
];
fs.writeFileSync(path.join(HERE, 'orders.hl7'), hl7.join('\r') + '\r');
console.log('hl7 written');
