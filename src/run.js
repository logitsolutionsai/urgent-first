// Run folders: everything a run writes lives inside one folder, written through writeInside().
import fs from 'node:fs';
import path from 'node:path';
import { UserError, writeInside, readJson, VERSION } from './util.js';
import { triage } from './engine.js';
import { renderMarkdown } from './render/markdown.js';
import { renderHtml } from './render/html.js';
import { stripGold } from './items.js';

export function defaultRunDir(packName, nowIso, base = process.cwd()) {
  const stamp = nowIso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
  return path.join(base, 'urgent-first-runs', `${packName}-${stamp}`);
}

/** A run folder must be new, empty, or an earlier urgent-first run folder. */
export function prepareRunDir(dir) {
  const abs = path.resolve(dir);
  if (fs.existsSync(abs)) {
    if (!fs.statSync(abs).isDirectory()) throw new UserError(`Output path exists and is not a folder: ${abs}`);
    const entries = fs.readdirSync(abs);
    if (entries.length && !entries.includes('run.json')) {
      throw new UserError(`Output folder ${abs} is not empty and is not an urgent-first run folder. Choose a new folder with --out.`);
    }
  }
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

export function loadRun(dir) {
  const abs = path.resolve(dir);
  const runFile = path.join(abs, 'run.json');
  if (!fs.existsSync(runFile)) throw new UserError(`${abs} is not an urgent-first run folder (no run.json)`);
  const run = readJson(runFile);
  const items = readJson(path.join(abs, 'items.json'));
  const rules = readJson(path.join(abs, 'results.rules.json'));
  const current = fs.existsSync(path.join(abs, 'results.json')) ? readJson(path.join(abs, 'results.json')) : rules;
  return { dir: abs, run, items, rules, current };
}

export function writeBoards(dir, result, pack, items, { newIds = null, suffix = '' } = {}) {
  const itemsById = new Map(items.map((it) => [it.id, it]));
  const md = renderMarkdown(result, { pack, newIds });
  const html = renderHtml(result, { pack, itemsById, newIds });
  writeInside(dir, `board${suffix}.md`, md);
  writeInside(dir, `board${suffix}.html`, html);
  return { md, html };
}

/** Triage items and write a complete run folder. */
export function executeRun({ pack, items, outDir, now, inputLabel, newIds = null, extra = {}, templates = null, linked = null }) {
  const plain = items.map(stripGold);
  const result = triage(plain, pack, { now, inputLabel, templates, linked });
  const dir = prepareRunDir(outDir);
  writeInside(
    dir,
    'run.json',
    JSON.stringify(
      {
        tool: 'urgent-first',
        version: VERSION,
        pack: pack.name,
        pack_version: pack.version,
        pack_file: pack._file,
        mode: pack.mode,
        input: inputLabel,
        now,
        ...extra,
      },
      null,
      2,
    ) + '\n',
  );
  writeInside(dir, 'items.json', JSON.stringify(plain, null, 2) + '\n');
  writeInside(dir, 'results.rules.json', JSON.stringify(result, null, 2) + '\n');
  writeInside(dir, 'results.json', JSON.stringify(result, null, 2) + '\n');
  const boards = writeBoards(dir, result, pack, plain, { newIds });
  writeInside(dir, 'board.rules.md', boards.md);
  return { dir, result, items: plain, boards };
}
