// Golden test: every bundled pack, unchanged, must keep byte-identical `eval --json` output on every split
// (dev and test, rules only and with the split's annotations file where one exists).
// The golden files in tests/golden/eval/ were written from the code before the Maintainer Radar release
// (snapshot, links, diff, digest, review, calibrate, pack lint) and must never be regenerated to make this
// test pass: a difference means the release changed how an unchanged pack scores.
// To regenerate deliberately (a pack or engine change that is meant to move numbers): UF_WRITE_GOLDEN=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, runCli } from './helpers.js';
import { BENCHES } from '../scripts/update-bench-results.js';

const GOLDEN = path.join(ROOT, 'tests', 'golden', 'eval');

function cases() {
  const out = [];
  for (const name of BENCHES) {
    for (const split of ['dev', 'test']) {
      const file = path.join('bench', name, `${split}.jsonl`);
      if (!fs.existsSync(path.join(ROOT, file))) continue;
      out.push({ name, split, file, args: ['eval', name, file, '--json'] });
      const ann = path.join('bench', name, `annotations.${split}.jsonl`);
      if (fs.existsSync(path.join(ROOT, ann))) out.push({ name, split: `${split}.annotated`, file, args: ['eval', name, file, '--annotations', ann, '--json'] });
    }
  }
  return out;
}

for (const c of cases()) {
  test(`golden: eval ${c.name} ${c.split} is byte-identical to the pre-release output`, () => {
    const r = runCli(c.args);
    assert.equal(r.code, 0, r.stderr);
    const f = path.join(GOLDEN, `${c.name}.${c.split}.json`);
    if (process.env.UF_WRITE_GOLDEN === '1') fs.writeFileSync(f, r.stdout);
    assert.ok(fs.existsSync(f), `missing golden file ${f}`);
    assert.equal(r.stdout, fs.readFileSync(f, 'utf8'));
  });
}
