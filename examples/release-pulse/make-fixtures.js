#!/usr/bin/env node
// Builds the recorded GitHub API folders for the Release Pulse demo and the Maintainer Radar tests.
// Run: node examples/release-pulse/make-fixtures.js
// Everything is invented: the repository acme/widget, its issues, numbers and dates. Each folder declares
// "_meta": { "synthetic": true }, so snapshots taken from it mark every item synthetic (and only then may a
// --public Pulse be exported without --allow-real-public-export).
//
//   examples/release-pulse/v3.1/       12 open issues, latest release v3.1.0
//   examples/release-pulse/v3.2/       16 open issues, latest release v3.2.0: three new installer reports,
//                                      a pull request that fixes one of them, a feature request, an edited
//                                      report; one issue from v3.1 was closed
//   tests/fixtures/radar/partial/      101 open issues on two pages; the second page answers HTTP 403 with the
//                                      rate limit exhausted
//   tests/fixtures/radar/scope-all/    the v3.2 issues plus closed ones, for a --state all snapshot
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const REPO = 'acme/widget';

function issue({ number, title, body, labels = [], created_at, state = 'open', pr = false, comments = 0, repo = REPO }) {
  const base = `https://api.github.com/repos/${repo}`;
  return {
    url: `${base}/issues/${number}`,
    html_url: `https://github.com/${repo}/${pr ? 'pull' : 'issues'}/${number}`,
    number,
    title,
    user: { login: 'synthetic-user', type: 'User' },
    labels: labels.map((name) => ({ name })),
    state,
    comments,
    created_at,
    updated_at: created_at,
    closed_at: state === 'closed' ? created_at : null,
    author_association: 'NONE',
    body,
    reactions: { total_count: 0, '+1': 0 },
    ...(pr ? { pull_request: { url: `${base}/pulls/${number}`, html_url: `https://github.com/${repo}/pull/${number}` }, draft: false } : {}),
  };
}

const TEMPLATE = `### Checklist
- [ ] I searched for existing issues
- [ ] This is not a security vulnerability (report those privately)
- [ ] I read the contributing guide
`;

const BASE = [
  { number: 701, title: 'Export to PDF cuts off the last page', created_at: '2026-10-20T09:00:00Z', labels: ['bug'], body: `${TEMPLATE}\nWhen I export a long note to PDF the last page is missing. No workaround that I can find, printing to PDF from the browser has the same problem.` },
  { number: 702, title: 'Sync conflict deleted my notes', created_at: '2026-10-21T10:00:00Z', labels: ['bug'], body: `${TEMPLATE}\nTwo devices edited the same folder. After the conflict dialog every note in the folder was gone and the trash is empty. I lost my notes from the last week.` },
  { number: 703, title: 'Dark mode for the export dialog', created_at: '2026-10-22T11:00:00Z', labels: ['enhancement'], body: `${TEMPLATE}\nThe export dialog is still bright white in dark mode. Would be nice to match the theme.` },
  { number: 704, title: 'Crash when opening a project with an emoji in its name', created_at: '2026-10-23T12:00:00Z', labels: ['bug'], body: `${TEMPLATE}\nThe app crashes when I open a project called "Trip 🏖". Renaming the project avoids it.` },
  { number: 705, title: 'docs: fix typo in the sync guide', created_at: '2026-10-24T13:00:00Z', labels: ['documentation'], pr: true, body: 'Fixes a small typo in docs/sync.md.' },
  { number: 706, title: 'Sidebar flickers while resizing the window', created_at: '2026-10-25T14:00:00Z', labels: ['bug'], body: `${TEMPLATE}\nDragging the window edge makes the sidebar flicker. Cosmetic, but distracting.` },
  { number: 707, title: 'Question: can I self-host the sync server?', created_at: '2026-10-26T15:00:00Z', labels: ['question'], body: 'Is there a documented way to run the sync server on my own machine?' },
  { number: 708, title: 'Search feels slow on a large vault', created_at: '2026-10-27T16:00:00Z', labels: ['performance'], body: `${TEMPLATE}\nSearching a vault with 40,000 notes takes a few seconds. It used to be quicker, but it is usable.` },
  { number: 709, title: 'Add a word count to the status bar', created_at: '2026-10-28T17:00:00Z', labels: ['enhancement'], body: `${TEMPLATE}\nA live word count for the current note would help when I write articles.` },
  { number: 710, title: 'Conflict dialog shows twice (no data loss)', created_at: '2026-10-29T18:00:00Z', labels: ['bug'], body: `${TEMPLATE}\nAfter a sync conflict the dialog appears twice. We had no data loss, both copies were kept, it is just confusing.` },
  { number: 711, title: 'Keyboard shortcut to toggle the sidebar', created_at: '2026-10-30T19:00:00Z', labels: ['enhancement'], body: `${TEMPLATE}\nCtrl+B in other editors hides the sidebar. Could we have the same?` },
  { number: 712, title: 'Settings page has a typo in "Synchronisation"', created_at: '2026-10-31T20:00:00Z', labels: [], body: `${TEMPLATE}\nThe heading on the settings page reads "Synchronisaton".` },
];

const BASE_BY_NUMBER = new Map(BASE.map((b) => [b.number, b]));
const EDITED_712 = { ...BASE_BY_NUMBER.get(712), title: 'Settings page crashes on startup after the typo fix', body: `${TEMPLATE}\nSince the nightly with the typo fix, the app crashes on startup whenever the settings page was the last page open.` };

const AFTER_NEW = [
  { number: 713, title: 'Installer fails with EACCES on macOS', created_at: '2026-11-11T08:15:00Z', labels: ['bug'], body: `${TEMPLATE}\nThe 3.2.0 installer fails at the last step:\n\n\`\`\`\nError: EACCES: permission denied, mkdir '/Applications/Widget.app'\n\`\`\`\n\nThe installer fails every time, so I cannot install the update.` },
  { number: 714, title: '3.2.0 installer fails: EACCES permission denied', created_at: '2026-11-11T13:40:00Z', labels: [], body: `${TEMPLATE}\nSame here on macOS 15. The installer fails with EACCES (permission denied) when it copies the app, and I am unable to install 3.2.0.` },
  { number: 715, title: 'Unable to install 3.2.0, installer exits with EACCES', created_at: '2026-11-12T07:05:00Z', labels: [], body: `${TEMPLATE}\nInstaller fails on two Macs at the copy step with EACCES permission denied. Version 3.1.0 installed fine.` },
  { number: 717, title: 'Option to export a folder as one Markdown file', created_at: '2026-11-13T10:00:00Z', labels: ['enhancement'], body: `${TEMPLATE}
It would help to export a whole folder into a single Markdown file for sharing.` },
  { number: 716, title: 'Fix installer permission check on macOS', created_at: '2026-11-12T15:30:00Z', labels: [], pr: true, body: 'Fixes #713\n\nThe installer now asks for permission before copying into /Applications.\nAlso related to #702, which touches the same folder code, but this does not change sync.' },
];

function writeFolder(dir, { issues, release, perPage = null, meta = { synthetic: true }, owner = 'acme', repo = 'widget', page2 = null, state = 'open' }) {
  fs.mkdirSync(dir, { recursive: true });
  const index = { _meta: { ...meta, note: 'Recorded-format GitHub API responses; every item is invented.' } };
  if (page2) {
    const q = `state=${state}&sort=created&direction=desc&per_page=${perPage}`;
    fs.writeFileSync(path.join(dir, 'issues-page1.json'), JSON.stringify(issues, null, 2) + '\n');
    index[`GET /repos/${owner}/${repo}/issues?${q}`] = { status: 200, file: 'issues-page1.json', etag: 'W/"synthetic-page-1"', headers: { 'x-ratelimit-remaining': '1', link: `<https://api.github.com/repos/${owner}/${repo}/issues?${q}&page=2>; rel="next"` } };
    index[`GET /repos/${owner}/${repo}/issues?${q}&page=2`] = page2;
  } else {
    fs.writeFileSync(path.join(dir, 'issues-page1.json'), JSON.stringify(issues, null, 2) + '\n');
    index[`GET /repos/${owner}/${repo}/issues*`] = { status: 200, file: 'issues-page1.json', etag: `W/"synthetic-${path.basename(dir)}"`, headers: { 'x-ratelimit-remaining': '58' } };
  }
  if (release) {
    fs.writeFileSync(path.join(dir, 'release-latest.json'), JSON.stringify(release, null, 2) + '\n');
    index[`GET /repos/${owner}/${repo}/releases/latest`] = { status: 200, file: 'release-latest.json', headers: { 'x-ratelimit-remaining': '57' } };
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}

const rel = (tag, published_at) => ({ tag_name: tag, name: `widget ${tag.slice(1)}`, html_url: `https://github.com/${REPO}/releases/tag/${tag}`, draft: false, prerelease: false, published_at, body: 'Synthetic release notes.' });
const newestFirst = (list) => [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

const before = BASE.map((b) => issue(b));
const afterList = [...BASE.filter((b) => b.number !== 707 && b.number !== 712), EDITED_712, ...AFTER_NEW];
const after = afterList.map((b) => issue(b));

writeFolder(path.join(HERE, 'v3.1'), { issues: newestFirst(before), release: rel('v3.1.0', '2026-10-01T09:00:00Z') });
writeFolder(path.join(HERE, 'v3.2'), { issues: newestFirst(after), release: rel('v3.2.0', '2026-11-10T00:00:00Z') });

const closed = [issue({ ...BASE_BY_NUMBER.get(707), state: 'closed' }), issue({ number: 690, title: 'Bump the build image', created_at: '2026-10-05T09:00:00Z', pr: true, state: 'closed', body: 'Routine dependency bump.' })];
writeFolder(path.join(ROOT, 'tests', 'fixtures', 'radar', 'scope-all'), { issues: newestFirst([...after, ...closed]), release: rel('v3.2.0', '2026-11-10T00:00:00Z') });

const many = [];
for (let i = 0; i < 100; i++) many.push(issue({ number: 2000 - i, title: `Synthetic report ${i + 1} about the editor toolbar`, created_at: new Date(Date.UTC(2026, 10, 1, 12, 0, 0) - i * 3600000).toISOString(), body: i === 3 ? 'After the update I lost all my notes and the backup folder is empty.' : 'The toolbar icons look slightly blurry on a 4K screen.', repo: 'acme/partial' }));
writeFolder(path.join(ROOT, 'tests', 'fixtures', 'radar', 'partial'), {
  issues: many,
  release: null,
  perPage: 100,
  owner: 'acme',
  repo: 'partial',
  page2: { status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794700000' } },
});
process.stdout.write('Wrote examples/release-pulse/v3.1, v3.2 and tests/fixtures/radar/{scope-all,partial}\n');
