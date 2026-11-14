// Guards the wording rules: no file in the repository may use words that claim the software finds or
// decides clinical conditions or carries a regulatory status. The words are stored reversed so this file
// does not contain them either.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const rev = (s) => s.split('').reverse().join('');
const BANNED = ['stceted', 'sesongaid', 'redaer tsrif', 'tDAC', 'strela', 'detadilav yllacinilc', 'tpmexe-ADF', 'tnailpmoc-AAPIH'].map(rev);
const SKIP_DIRS = new Set(['node_modules', '.git', 'output']);
const TEXT_EXT = new Set(['.js', '.mjs', '.json', '.jsonl', '.md', '.html', '.css', '.csv', '.hl7', '.txt', '.yml', '.yaml']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (TEXT_EXT.has(path.extname(e.name).toLowerCase()) || e.name === 'LICENSE' || e.name === '.gitignore') yield p;
  }
}

test('no file uses the banned wording', () => {
  const hits = [];
  for (const f of walk(ROOT)) {
    const text = fs.readFileSync(f, 'utf8');
    for (const w of BANNED) {
      const re = new RegExp(`(^|[^A-Za-z])${w.replace(/[-]/g, '[- ]?')}([^A-Za-z]|$)`, 'i');
      if (re.test(text)) hits.push(`${path.relative(ROOT, f)}: ${rev(rev(w))}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('no pack rule or benchmark case carries SNOMED, WHO ICD-10 or CPT content', () => {
  // READMEs may say these are absent; rules and cases must not contain them.
  const hits = [];
  for (const f of walk(path.join(ROOT, 'packs'))) {
    if (!f.endsWith('pack.json')) continue;
    const text = fs.readFileSync(f, 'utf8');
    if (/snomed|icd-?10|\bcpt\b/i.test(text)) hits.push(path.relative(ROOT, f));
  }
  for (const f of walk(path.join(ROOT, 'bench'))) {
    if (!f.endsWith('.jsonl')) continue;
    if (/snomed|icd-?10|\bcpt\b/i.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(ROOT, f));
  }
  assert.deepEqual(hits, []);
});
