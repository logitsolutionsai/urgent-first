// Golden test for the commands the Maintainer Radar release refactored around (github, run): their run
// folders must stay byte-identical to the output of the code before the release. Written once from the
// pre-release code; regenerate only deliberately with UF_WRITE_GOLDEN=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, runCli, tmpDir } from './helpers.js';

const GOLDEN = path.join(ROOT, 'tests', 'golden', 'runs');
const FILES = ['results.rules.json', 'results.json', 'board.md', 'board.html', 'items.json'];

const CASES = [
  { name: 'github-fixture', args: (out) => ['github', 'acme/widget', '--out', out, '--now', '2026-10-22T12:00:00Z'], env: { URGENT_FIRST_GITHUB_FIXTURE: path.join(ROOT, 'tests', 'fixtures', 'github') } },
  { name: 'github-fixture-updated', args: (out) => ['github', 'acme/widget', '--out', out, '--now', '2026-10-23T12:00:00Z'], env: { URGENT_FIRST_GITHUB_FIXTURE: path.join(ROOT, 'tests', 'fixtures', 'github-updated') } },
  { name: 'run-github-dev', args: (out) => ['run', 'github-maintainer', path.join('bench', 'github-maintainer', 'dev.jsonl'), '--out', out, '--now', '2026-11-14T09:00:00Z'], env: {} },
  { name: 'run-radiology-example', args: (out) => ['run', 'radiology-research', path.join('examples', 'radiology-worklist.jsonl'), '--out', out, '--now', '2026-11-14T09:30:00Z'], env: {} },
];

for (const c of CASES) {
  test(`golden: ${c.name} run folder is byte-identical to the pre-release output`, () => {
    const out = path.join(tmpDir(), 'run');
    const r = runCli(c.args(out), { env: { URGENT_FIRST_CACHE: tmpDir('uf-cache-'), ...c.env } });
    assert.equal(r.code, 0, r.stderr);
    for (const f of FILES) {
      const g = path.join(GOLDEN, `${c.name}.${f}`);
      const now = fs.readFileSync(path.join(out, f), 'utf8');
      if (process.env.UF_WRITE_GOLDEN === '1') fs.writeFileSync(g, now);
      assert.ok(fs.existsSync(g), `missing golden ${g}`);
      assert.equal(now, fs.readFileSync(g, 'utf8'), `${c.name} ${f} changed`);
    }
  });
}
