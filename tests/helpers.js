// Shared test helpers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compilePack, loadPack } from '../src/pack.js';
import { normalizeItems } from '../src/items.js';
import { prepareItem, evaluate } from '../src/match/conditions.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(ROOT, 'scripts', 'urgent-first.mjs');

export function tmpDir(prefix = 'uf-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function runCli(args, { env = {}, cwd = ROOT } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A minimal pack with one rule per condition given. */
export function miniPack(rules, extra = {}) {
  return compilePack({
    name: 'mini',
    version: '0.0.1',
    title: 'Mini',
    tiers: [
      { id: 'T1', name: 'Now', sla_minutes: 60 },
      { id: 'T2', name: 'Today', sla_minutes: 480 },
      { id: 'T3', name: 'In order' },
    ],
    rules: rules.map((r, i) => ({ id: r.id || `R${i + 1}`, tier: r.tier || 'T1', title: r.title || 'Rule', why: 'test', source: { citation: 'test', url: 'https://example.org' }, match: r.match })),
    ...extra,
  });
}

export function item(text, extra = {}) {
  return normalizeItems([{ id: extra.id || 'x1', title: extra.title || '', text: typeof text === 'string' ? { text } : text, synthetic: true, ...extra }])[0];
}

/** Evaluate one condition against a sentence; returns { ok, evidence, suppressed }. */
export function check(cond, text, packExtra = {}) {
  const pack = miniPack([{ match: cond }], packExtra);
  const doc = prepareItem(item(text), pack);
  const r = evaluate(cond, doc, 'R1');
  return { ...r, suppressed: doc.suppressed };
}

export const radiology = () => loadPack('radiology-research');
export const github = () => loadPack('github-maintainer');
