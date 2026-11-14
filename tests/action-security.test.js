// P4: the read-only GitHub Actions starter, no write path to GitHub, clinical isolation on every guard entry
// point, credentials never echoed, and safe artifact writing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, runCli, tmpDir } from './helpers.js';
import { writeAtomic, snapshotDigest } from '../src/snapshot/snapshot.js';

const WF = path.join(ROOT, 'github-actions', 'urgent-first.yml');
const EX = path.join(ROOT, 'examples', 'release-pulse');
const FX = path.join(ROOT, 'tests', 'fixtures');
const env = (fixture, extra = {}) => ({ env: { URGENT_FIRST_GITHUB_FIXTURE: fixture, URGENT_FIRST_CACHE: tmpDir('uf-cache-'), ...extra } });

test('the Actions starter is read-only: least-privilege permissions, trusted triggers only, no interpolation into shell', () => {
  const y = fs.readFileSync(WF, 'utf8');
  const code = y.replace(/^\s*#.*$/gm, '');
  const perms = /^permissions:\n((?:[ \t]+.*\n)+)/m.exec(code)[1];
  const entries = perms.trim().split('\n').map((l) => l.trim().split(/:\s*/));
  assert.deepEqual(entries.map(([k]) => k).sort(), ['contents', 'issues', 'pull-requests']);
  assert.ok(entries.every(([, v]) => v === 'read'), perms);
  assert.ok(!/:\s*write\b|write-all|permissions:\s*write/.test(code), 'no write permission anywhere');
  const on = /^on:\n((?:[ \t]+.*\n)+)/m.exec(code)[1];
  assert.deepEqual([...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]).sort(), ['schedule', 'workflow_dispatch']);
  assert.ok(!/pull_request_target|pull_request:|issue_comment|issues:\s*\n\s+types/.test(code), 'no untrusted trigger');
  assert.match(code, /persist-credentials: false/);
  // No ${{ }} expression inside a run: script (expressions go through env), and no event text anywhere.
  const runs = [...code.matchAll(/run: \|\n((?:[ \t]{10,}.*\n)+)|run: (.*)\n/g)].map((m) => m[1] || m[2]);
  assert.ok(runs.length >= 3);
  for (const r of runs) assert.ok(!r.includes('${{'), `expression in run: ${r}`);
  assert.ok(!/github\.event\.(issue|pull_request|comment)|\.body\b|\.title\b/.test(code), 'no issue or pull request text in the workflow');
  // Every command the workflow runs exists and only reads.
  for (const m of code.matchAll(/urgent-first\.mjs (\w+)/g)) assert.ok(['snapshot', 'digest', 'diff'].includes(m[1]), m[1]);
});

test('there is no write path to GitHub: no apply command, no non-GET request in the source', () => {
  for (const cmd of ['apply', 'label', 'comment', 'webhook', 'notify']) {
    const r = runCli([cmd, '--plan', 'x', '--approve', 'y']);
    assert.equal(r.code, 1, cmd);
    assert.match(r.stderr, /Unknown command/);
  }
  const src = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name.endsWith('.js')) src.push(fs.readFileSync(path.join(d, e.name), 'utf8'));
    }
  };
  walk(path.join(ROOT, 'src'));
  const all = src.join('\n');
  assert.ok(!/method:\s*['"](?:POST|PUT|PATCH|DELETE)/i.test(all), 'no write HTTP method');
  assert.ok(!/\/labels['"`]\s*,\s*\{|\/comments['"`]\s*,\s*\{/.test(all));
  assert.match(runCli(['--help']).stdout, /There is no apply command/);
});

test('scenario 11: research packs are refused at every guard entry point, and the synthetic run is unchanged', () => {
  const rad = 'radiology-research';
  const ex = path.join(ROOT, 'examples', 'radiology-worklist.jsonl');
  const cases = [
    ['snapshot github', ['snapshot', 'github', 'acme/widget', '--pack', rad, '--out', path.join(tmpDir(), 's')], env(path.join(EX, 'v3.2'))],
    ['snapshot run', ['snapshot', 'run', rad, ex, '--out', path.join(tmpDir(), 's')], {}],
    ['github watch', ['github', 'acme/widget', '--pack', rad, '--watch'], env(path.join(FX, 'github'))],
    ['watch (notifications)', ['watch', rad, ex, '--polls', '1'], {}],
    ['calibrate', ['calibrate', rad, 'x.json', '--snapshot', 'x', '--out', path.join(tmpDir(), 'p')], {}],
  ];
  for (const [name, args, opts] of cases) {
    const r = runCli(args, opts);
    assert.equal(r.code, 2, `${name}: ${r.stderr}`);
    assert.match(r.stderr, /research mode/, name);
  }
  // A snapshot edited to claim a research pack: links, diff (and so --public), digest and review refuse it.
  const real = path.join(tmpDir(), 'snap');
  assert.equal(runCli(['snapshot', 'github', 'acme/widget', '--out', real], env(path.join(EX, 'v3.2'))).code, 0);
  const fake = path.join(tmpDir(), 'fake');
  fs.cpSync(real, fake, { recursive: true });
  const f = path.join(fake, 'snapshot.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  s.pack.mode = 'research';
  s.snapshotId = snapshotDigest(s);
  fs.writeFileSync(f, JSON.stringify(s));
  for (const args of [['links', fake], ['diff', fake, real, '--public'], ['digest', fake], ['review', 'init', fake, '--out', path.join(tmpDir(), 'r.json')]]) {
    const r = runCli(args);
    assert.equal(r.code, 2, args.join(' '));
  }
  // The one-off synthetic research run still works, with its banner (tests/run-golden.test.js pins its output).
  const ok = runCli(['run', rad, ex, '--out', path.join(tmpDir(), 'run'), '--now', '2026-11-14T09:30:00Z']);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /RESEARCH MODE/);
  // pack lint may read a research pack (static checks only).
  assert.equal(runCli(['pack', 'lint', rad]).code, 0);
});

test('credentials are never echoed: not on a failing request, not in --json output, not in any written file', () => {
  const secret = 'ghp_SYNTHETICsecretTOKEN0987654321';
  const r = runCli(['github', 'acme/partial', '--limit', '150', '--out', path.join(tmpDir(), 'run')], env(path.join(FX, 'radar', 'partial'), { GITHUB_TOKEN: secret }));
  assert.equal(r.code, 3);
  assert.ok(!r.stderr.includes(secret) && !r.stdout.includes(secret));
  const out = path.join(tmpDir(), 'snap');
  const j = runCli(['snapshot', 'github', 'acme/partial', '--limit', '150', '--out', out, '--json'], env(path.join(FX, 'radar', 'partial'), { GITHUB_TOKEN: secret }));
  assert.equal(j.code, 0, j.stderr);
  assert.ok(!j.stdout.includes(secret) && !j.stderr.includes(secret));
  for (const f of fs.readdirSync(out)) assert.ok(!fs.readFileSync(path.join(out, f), 'utf8').includes(secret), f);
  assert.ok(!/Authorization|Bearer/.test(fs.readFileSync(path.join(out, 'collection.json'), 'utf8')));
});

test('artifact writing stays inside the output folder and never writes through a link', () => {
  const root = tmpDir();
  assert.throws(() => writeAtomic(root, '../escape.json', '{}'), /outside the output folder/);
  assert.throws(() => writeAtomic(root, path.join('..', '..', 'escape.json'), '{}'), /outside the output folder/);
  const target = tmpDir();
  const link = path.join(tmpDir(), 'link');
  try {
    fs.symlinkSync(target, link, 'junction');
  } catch {
    return; // the platform does not allow links here; the lexical checks above still ran
  }
  const r = runCli(['snapshot', 'github', 'acme/widget', '--out', link], env(path.join(EX, 'v3.1')));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /into a link/);
  assert.deepEqual(fs.readdirSync(target), []);
});
