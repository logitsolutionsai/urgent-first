#!/usr/bin/env node
// Builds the README's Release Pulse demo from the recorded, synthetic acme/widget fixtures:
//   examples/release-pulse/snapshots/v3.1, snapshots/v3.2   snapshot github on the two fixture folders
//   examples/release-pulse/pulse/                            diff --public (pulse.md, pulse.html, pulse.json)
//   examples/release-pulse/digest/                           digest of v3.2 with --previous v3.1
// tests/pulse.test.js fails if pulse.json no longer equals what the code generates from the fixtures.
// Optional: --screenshot renders docs/media/release-pulse-light.png and -dark.png with the installed Chrome
// (never downloads a browser; every network request is aborted).
// Run: node examples/release-pulse/build-demo.js [--screenshot]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CLI = path.join(ROOT, 'scripts', 'urgent-first.mjs');

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, URGENT_FIRST_CACHE: path.join(HERE, '.cache-unused'), ...env } });
  if (r.status !== 0) throw new Error(`${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

for (const v of ['v3.1', 'v3.2']) run(['snapshot', 'github', 'acme/widget', '--out', path.join(HERE, 'snapshots', v), '--force'], { URGENT_FIRST_GITHUB_FIXTURE: path.join(HERE, v) });
const snaps = (v) => path.join(HERE, 'snapshots', v);
process.stdout.write(run(['diff', snaps('v3.1'), snaps('v3.2'), '--out', path.join(HERE, 'pulse'), '--public', '--force']));
process.stdout.write(run(['digest', snaps('v3.2'), '--previous', snaps('v3.1'), '--out', path.join(HERE, 'digest'), '--force']));
// collection.json records when the demo was built; it is not part of the deterministic snapshot.
fs.rmSync(path.join(HERE, '.cache-unused'), { recursive: true, force: true });

if (process.argv.includes('--screenshot')) {
  const { chromium } = await import('playwright-core');
  const chrome = process.env.URGENT_FIRST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    for (const scheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme });
      await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
      await page.goto(pathToFileURL(path.join(HERE, 'pulse', 'pulse.html')).href);
      await page.screenshot({ path: path.join(ROOT, 'docs', 'media', `release-pulse-${scheme}.png`), fullPage: false });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  process.stdout.write('Screenshots: docs/media/release-pulse-light.png, docs/media/release-pulse-dark.png\n');
}
