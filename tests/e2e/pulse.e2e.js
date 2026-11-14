// End-to-end: the Release Pulse and digest pages in the installed Chrome (never downloads a browser), every
// network request aborted. Checks: no console or CSP errors, no request leaves the page, sections and counts
// match pulse.json, no sideways scroll at 1280x800 and 390x844, links reachable by keyboard with a visible
// focus ring, tiers shown by ink weight (no red, green or yellow), and press feedback within 50 ms.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { ROOT, CLI } from '../helpers.js';


const OUT = path.join(ROOT, 'tests', 'output');
fs.mkdirSync(OUT, { recursive: true });
// Same lookup as board.e2e.js (not imported: importing a test file would run its tests twice).
function findChrome() {
  if (process.env.URGENT_FIRST_CHROME) return process.env.URGENT_FIRST_CHROME;
  const c = {
    win32: [path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
  }[process.platform] || [];
  return c.find((x) => x && fs.existsSync(x)) || null;
}
const chromePath = findChrome();

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
}

function render() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uf-e2e-pulse-'));
  const cache = path.join(tmp, 'cache');
  for (const v of ['v3.1', 'v3.2']) run(['snapshot', 'github', 'acme/widget', '--out', path.join(tmp, v)], { URGENT_FIRST_GITHUB_FIXTURE: path.join(ROOT, 'examples', 'release-pulse', v), URGENT_FIRST_CACHE: cache });
  run(['diff', path.join(tmp, 'v3.1'), path.join(tmp, 'v3.2'), '--out', path.join(tmp, 'pulse')]);
  run(['digest', path.join(tmp, 'v3.2'), '--previous', path.join(tmp, 'v3.1'), '--out', path.join(tmp, 'digest')]);
  return { pulse: path.join(tmp, 'pulse', 'pulse.html'), pulseJson: JSON.parse(fs.readFileSync(path.join(tmp, 'pulse', 'pulse.json'), 'utf8')), digest: path.join(tmp, 'digest', 'digest.html') };
}

test('Release Pulse and digest pages render offline, accessible, ink-only, at desktop and phone widths', { skip: chromePath ? false : 'no Chrome found (set URGENT_FIRST_CHROME)', timeout: 180000 }, async () => {
  const r = render();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'] });
  try {
    for (const [name, file] of [['pulse', r.pulse], ['digest', r.digest]]) {
      for (const [label, viewport, scheme] of [['desktop', { width: 1280, height: 800 }, 'light'], ['mobile', { width: 390, height: 844 }, 'dark']]) {
        const page = await browser.newPage({ viewport, colorScheme: scheme });
        const external = [];
        await page.route('**/*', (route) => {
          const url = route.request().url();
          if (url.startsWith('file:')) return route.continue();
          external.push(url);
          return route.abort();
        });
        const errors = [];
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text());
        });
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(pathToFileURL(file).href);
        await page.waitForTimeout(150);
        assert.deepEqual(errors, [], `${name} ${label}: console errors`);
        assert.deepEqual(external, [], `${name} ${label}: no network`);
        const layout = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
        assert.ok(layout.sw <= layout.vw, `${name} ${label}: sideways scroll ${layout.sw} > ${layout.vw}`);
        // Tiers by weight only: every colour in use is a neutral grey or the one accent.
        const colours = await page.evaluate(() => {
          const set = new Set();
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el);
            for (const v of [cs.color, cs.backgroundColor, cs.borderLeftColor, cs.borderTopColor]) set.add(v);
          }
          return [...set];
        });
        for (const c of colours) {
          const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c);
          if (!m) continue;
          const [R, G, B] = m.slice(1, 4).map(Number);
          const neutral = Math.max(R, G, B) - Math.min(R, G, B) <= 12;
          const accent = B > R + 60 && B > G + 30; // #0065FD and #5b9cff and their tints
          assert.ok(neutral || accent, `${name} ${label}: colour ${c} is neither ink nor the accent`);
        }
        // Keyboard: the first tab stop is a link or chip with a visible focus ring.
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const el = document.activeElement;
          const cs = getComputedStyle(el);
          return { tag: el.tagName, outline: cs.outlineStyle, width: cs.outlineWidth };
        });
        assert.equal(focus.tag, 'A', `${name} ${label}: first tab stop`);
        assert.equal(focus.outline, 'solid');
        if (name === 'pulse') {
          const counts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-count] b')].map((b) => [b.closest('[data-count]').dataset.count, Number(b.textContent)])));
          assert.equal(counts['newly-flagged'], r.pulseJson.counts.newlyFlagged);
          assert.equal(counts['tier-changes'], r.pulseJson.counts.tierChanges);
          assert.equal(counts.related, r.pulseJson.counts.clustersWithNewMembers);
          const cards = await page.evaluate(() => document.querySelectorAll('#newly-flagged .card').length);
          assert.equal(cards, r.pulseJson.sections.newlyFlagged.length);
          const text = await page.evaluate(() => document.body.innerText);
          assert.match(text, /reported after release v3\.2\.0/);
          assert.ok(!/caused by/i.test(text));
          // Press feedback on a chip within 50 ms (Fluid.pressable from the board script).
          const chip = page.locator('a.chip').first();
          const box = await chip.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(50);
          const transform = await chip.evaluate((el) => getComputedStyle(el).transform);
          await page.mouse.up();
          assert.notEqual(transform, 'none', 'press feedback within 50 ms');
        } else {
          for (const id of ['discuss-first', 'related', 'since']) assert.ok(await page.locator(`#${id}`).count(), id);
        }
        await page.screenshot({ path: path.join(OUT, `${name}-${label}-${scheme}.png`), fullPage: false });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
