// Small shared helpers. No dependencies.
import fs from 'node:fs';
import path from 'node:path';

export const VERSION = '0.1.0';

export class UserError extends Error {
  constructor(message, { code = 1, details = [] } = {}) {
    super(message);
    this.name = 'UserError';
    this.exitCode = code;
    this.details = details;
  }
}

export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch (err) {
    throw new UserError(`Cannot read ${file}: ${err.code || err.message}`);
  }
}

export function readJson(file) {
  const text = readText(file);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UserError(`${file} is not valid JSON: ${err.message}`);
  }
}

export function parseJsonl(text, label = 'input') {
  const out = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) return;
    try {
      out.push(JSON.parse(trimmed));
    } catch (err) {
      throw new UserError(`${label} line ${i + 1} is not valid JSON: ${err.message}`);
    }
  });
  return out;
}

export function readJsonl(file) {
  return parseJsonl(readText(file), file);
}

export function toJsonl(rows) {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}

/** Parse an ISO 8601 date-time; returns epoch ms or null. */
export function parseTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : ms;
}

export function isoOrNull(ms) {
  return ms === null || ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString();
}

/** Human duration, e.g. 95 -> "1 h 35 min", 4000 -> "2 d 18 h". Minutes in, string out. */
export function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '';
  const sign = minutes < 0 ? '-' : '';
  let m = Math.round(Math.abs(minutes));
  if (m < 60) return `${sign}${m} min`;
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  if (d > 0) return `${sign}${d} d${h ? ` ${h} h` : ''}`;
  return `${sign}${h} h${m ? ` ${m} min` : ''}`;
}

/** Ensure `target` resolves inside `root`. Used by every writer so research runs cannot write elsewhere. */
export function assertInside(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  const rel = path.relative(r, t);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return t;
  throw new UserError(`Refusing to write outside the output folder: ${t}`);
}

export function writeInside(root, relPath, content) {
  const target = assertInside(root, path.join(root, relPath));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // The lexical check above is not enough when the run folder holds a link (a symlink or a Windows junction,
  // say in a run folder received from someone else): resolve real paths and never write through a link.
  assertInside(fs.realpathSync(root), fs.realpathSync(path.dirname(target)));
  if (isLink(target)) throw new UserError(`Refusing to write through a link inside the output folder: ${target}`);
  fs.writeFileSync(target, content);
  return target;
}

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A URL that boards may turn into a link: http(s) only, no whitespace or control characters, with Markdown's
 * link delimiters percent-encoded. Anything else (javascript:, data:, a relative path) is shown without a link.
 */
export function safeUrl(url) {
  const s = String(url ?? '').trim();
  if (!/^https?:\/\/[^\s\u0000-\u001f\u007f<>"'`]+$/i.test(s)) return null;
  return s.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/** Escape text for inline Markdown (not inside code spans). */
export function escapeMd(s) {
  return String(s ?? '').replace(/([\\`*_[\]<>|])/g, '\\$1').replace(/\r?\n/g, ' ');
}

export function clip(s, n) {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

/** Deterministic seeded PRNG (mulberry32). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stableSortBy(arr, keyFn) {
  return arr
    .map((v, i) => ({ v, i, k: keyFn(v) }))
    .sort((a, b) => {
      for (let j = 0; j < a.k.length; j++) {
        if (a.k[j] < b.k[j]) return -1;
        if (a.k[j] > b.k[j]) return 1;
      }
      return a.i - b.i;
    })
    .map((x) => x.v);
}
