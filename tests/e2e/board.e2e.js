// End-to-end board test: renders boards for both flagship packs, opens them in the installed Chrome
// (never downloads a browser) with every network request aborted, and checks what a person sees.
// Screenshots go to tests/output/ (gitignored).
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

export function findChrome() {
  if (process.env.URGENT_FIRST_CHROME) return process.env.URGENT_FIRST_CHROME;
  const candidates = {
    win32: [
      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
  }[process.platform] || [];
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r;
}

function renderBoards() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uf-e2e-'));
  const rad = path.join(tmp, 'radiology');
  run(['run', 'radiology-research', path.join(ROOT, 'examples', 'radiology-worklist.jsonl'), '--out', rad, '--now', '2026-11-14T09:30:00Z']);
  const radDev = path.join(tmp, 'radiology-dev');
  run(['run', 'radiology-research', path.join(ROOT, 'bench', 'radiology-research', 'dev.jsonl'), '--out', radDev, '--now', '2026-11-14T09:00:00Z']);
  const gh = path.join(tmp, 'github');
  run(['github', 'acme/widget', '--out', gh, '--now', '2026-10-22T12:00:00Z'], { URGENT_FIRST_GITHUB_FIXTURE: path.join(ROOT, 'tests', 'fixtures', 'github') });
  return { rad, radDev, gh };
}

/** Counts from board.md: "**Discuss First: N** (T1 ...: a · T2 ...: b) · **No rule matched: M**". */
function countsFromMarkdown(md) {
  const df = Number(/\*\*Discuss First: (\d+)\*\*/.exec(md)[1]);
  const nr = Number(/\*\*No rule matched: (\d+)\*\*/.exec(md)[1]);
  const tiers = {};
  for (const m of md.matchAll(/(T\d) [^:·()]+: (\d+)/g)) if (!(m[1] in tiers)) tiers[m[1]] = Number(m[2]);
  return { df, nr, tiers };
}

const chromePath = findChrome();

test('boards render offline, match board.md, highlight exact quotes and fit both viewports', { skip: chromePath ? false : 'no Chrome found (set URGENT_FIRST_CHROME)', timeout: 180000 }, async () => {
  const { rad, radDev, gh } = renderBoards();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'] });
  try {
    for (const [name, dir] of [['radiology', rad], ['radiology-dev', radDev], ['github', gh]]) {
      const md = fs.readFileSync(path.join(dir, 'board.md'), 'utf8');
      const results = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
      const items = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'items.json'), 'utf8')).map((i) => [i.id, i]));
      const expected = countsFromMarkdown(md);
      for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
        for (const scheme of label === 'desktop' ? ['light', 'dark'] : ['light']) {
          const context = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: label === 'mobile' ? 2 : 1 });
          const page = await context.newPage();
          const blocked = [];
          await page.route('**/*', (route) => {
            const url = route.request().url();
            if (url.startsWith('file:')) return route.continue();
            blocked.push(url);
            return route.abort();
          });
          const errors = [];
          page.on('console', (m) => {
            if (m.type() === 'error') errors.push(m.text());
          });
          page.on('pageerror', (e) => errors.push(String(e)));
          await page.goto(pathToFileURL(path.join(dir, 'board.html')).href);

          assert.deepEqual(errors, [], `${name} ${label}: console errors`);
          assert.deepEqual(blocked, [], `${name} ${label}: the page tried to load ${blocked.join(', ')}`);

          // Counts on the page equal board.md.
          const counts = await page.evaluate(() => {
            const n = (sel) => Number(document.querySelector(sel)?.querySelector('b')?.textContent);
            const tiers = {};
            for (const li of document.querySelectorAll('[data-count-tier]')) tiers[li.dataset.countTier] = Number(li.querySelector('b').textContent);
            return {
              df: n('[data-count="flagged"]'),
              nr: n('[data-count="unmatched"]'),
              tiers,
              cards: document.querySelectorAll('#discuss-first .card').length,
              plain: document.querySelectorAll('#no-rule-matched .plain > li').length,
            };
          });
          assert.equal(counts.df, expected.df, `${name}: Discuss First count`);
          assert.equal(counts.nr, expected.nr, `${name}: No rule matched count`);
          assert.equal(counts.cards, expected.df);
          assert.equal(counts.plain, expected.nr);
          for (const [t, v] of Object.entries(counts.tiers)) assert.equal(v, expected.tiers[t], `${name}: ${t} count`);

          // Evidence highlights: every <mark> equals the item text between its offsets, and every quoted
          // rule span of every flagged item is highlighted.
          const marks = await page.evaluate(() =>
            [...document.querySelectorAll('mark')].map((m) => ({ id: m.dataset.item, field: m.dataset.field, start: Number(m.dataset.start), end: Number(m.dataset.end), text: m.textContent })),
          );
          assert.ok(marks.length > 0, `${name}: highlights present`);
          for (const m of marks) {
            const it = items.get(m.id);
            const src = m.field === 'title' ? it.title : m.field === 'priority' ? it.priority : m.field === 'location' ? it.location : m.field.startsWith('labels[') ? it.labels[Number(/\d+/.exec(m.field)[0])] : it.text[m.field];
            assert.equal(src.slice(m.start, m.end), m.text, `${name}: mark ${m.id} ${m.field}`);
          }
          for (const r of results.items.filter((x) => x.rules.length)) {
            for (const rule of r.rules) {
              for (const e of rule.evidence) {
                const covered = marks.some((m) => m.id === r.id && m.field === e.field && m.start <= e.start && m.end >= e.end);
                assert.ok(covered, `${name}: ${r.id} ${rule.id} "${e.text}" is highlighted`);
              }
            }
          }

          // Layout: no horizontal scrolling and no element wider than the viewport.
          const layout = await page.evaluate(() => {
            const vw = document.documentElement.clientWidth;
            const over = [...document.querySelectorAll('body *')].filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.right > vw + 1;
            }).map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
            return { scrollWidth: document.documentElement.scrollWidth, vw, over: over.slice(0, 5) };
          });
          assert.ok(layout.scrollWidth <= layout.vw, `${name} ${label}: page scrolls sideways (${layout.scrollWidth} > ${layout.vw}): ${layout.over.join(', ')}`);

          // Research banner visible on the radiology board.
          if (name.startsWith('radiology')) {
            const banner = page.locator('#research-banner');
            assert.ok(await banner.isVisible(), 'research banner visible');
            const box = await banner.boundingBox();
            assert.ok(box.y < viewport.height, 'banner is above the fold');
            assert.match(await banner.textContent(), /Not a medical device; not cleared, approved or CE-marked/);
          } else {
            assert.equal(await page.locator('#research-banner').count(), 0);
          }

          if (name !== 'radiology-dev') {
            await page.screenshot({ path: path.join(OUT, `${name}-${label}-${scheme}.png`), fullPage: false });
            if (label === 'desktop' && scheme === 'light') await page.screenshot({ path: path.join(OUT, `${name}-${label}-full.png`), fullPage: true });
          }
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
});

test('pointerdown on a card toggle applies a transform within 50 ms; the body springs and reverses mid-flight', { skip: chromePath ? false : 'no Chrome found (set URGENT_FIRST_CHROME)', timeout: 120000 }, async () => {
  const gh = fs.mkdtempSync(path.join(os.tmpdir(), 'uf-e2e-press-'));
  run(['github', 'acme/widget', '--out', gh, '--now', '2026-10-22T12:00:00Z'], { URGENT_FIRST_GITHUB_FIXTURE: path.join(ROOT, 'tests', 'fixtures', 'github') });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'] });
  try {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(pathToFileURL(path.join(gh, 'board.html')).href);
      assert.deepEqual(errors, [], 'console errors (a CSP hash mismatch shows here)');

      const tog = page.locator('li.card[data-id="#790"] button.tog');
      assert.ok(await tog.isVisible(), 'the script reveals the card toggle');
      // Press: a transform appears on the toggle within 50 ms of pointerdown, measured inside the page.
      const press = await page.evaluate(async () => {
        const el = document.querySelector('li.card[data-id="#790"] button.tog');
        const r = el.getBoundingClientRect();
        const t0 = performance.now();
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: r.left + 4, clientY: r.top + 4 }));
        let at = null;
        while (performance.now() - t0 < 50) {
          if (getComputedStyle(el).transform !== 'none') { at = performance.now() - t0; break; }
          await new Promise((res) => requestAnimationFrame(res));
        }
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
        return { at, transform: getComputedStyle(el).transform };
      });
      assert.ok(press.at !== null && press.at <= 50, `${reducedMotion}: transform within 50 ms of pointerdown (got ${press.at} ms)`);

      // Collapse, then reverse mid-flight: the body height turns around from where it is.
      const body = page.locator('#cb-1');
      const full = await body.evaluate((el) => el.getBoundingClientRect().height);
      await tog.click();
      if (reducedMotion === 'reduce') {
        assert.ok(await body.isHidden(), 'reduced motion: the body closes instantly');
        assert.equal(await tog.getAttribute('aria-expanded'), 'false');
        await tog.click();
        assert.ok(await body.isVisible(), 'reduced motion: the body opens instantly');
        assert.equal(await body.evaluate((el) => el.style.height), '', 'no height left behind');
      } else {
        await page.waitForTimeout(90);
        const mid = await body.evaluate((el) => el.getBoundingClientRect().height);
        assert.ok(mid > 0 && mid < full, `mid-flight height ${mid} is between 0 and ${full}`);
        await tog.click();
        await page.waitForTimeout(40);
        const back = await body.evaluate((el) => el.getBoundingClientRect().height);
        assert.ok(back > 0 && back < full, `reversed from its live height (${back}), not reset`);
        await page.waitForFunction(() => document.querySelector('#cb-1').style.height === '', null, { timeout: 3000 });
        assert.equal(await tog.getAttribute('aria-expanded'), 'true');
        assert.ok(Math.abs((await body.evaluate((el) => el.getBoundingClientRect().height)) - full) < 1, 'settles at its full height');
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
