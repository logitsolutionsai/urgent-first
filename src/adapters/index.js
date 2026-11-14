// Input loading with format detection.
import fs from 'node:fs';
import path from 'node:path';
import { readText, parseJsonl, UserError } from '../util.js';
import { normalizeItems } from '../items.js';
import { csvToRawItems } from './csv.js';
import { fhirToRawItems, looksLikeFhir } from './fhir.js';
import { hl7ToRawItems } from './hl7v2.js';
import { issueToRawItem } from './github.js';

export const FORMATS = ['auto', 'jsonl', 'json', 'csv', 'fhir', 'hl7', 'github-json'];
const SUPPORTED_EXT = new Set(['.jsonl', '.ndjson', '.json', '.csv', '.hl7', '.txt']);

export function detectFormat(file, text) {
  const ext = path.extname(file).toLowerCase();
  const head = text.trimStart();
  if (ext === '.csv') return 'csv';
  if (ext === '.hl7' || head.startsWith('MSH')) return 'hl7';
  if (head.startsWith('[') || (head.startsWith('{') && ext === '.json')) {
    try {
      const obj = JSON.parse(text);
      if (looksLikeFhir(obj)) return 'fhir';
      if (Array.isArray(obj) && obj.length && obj[0] && typeof obj[0] === 'object' && 'number' in obj[0] && 'html_url' in obj[0]) return 'github-json';
      return 'json';
    } catch {
      /* fall through to JSONL */
    }
  }
  const firstLine = head.split(/\r?\n/, 1)[0];
  try {
    const obj = JSON.parse(firstLine);
    if (obj && obj.resourceType) return 'fhir-ndjson';
  } catch {
    /* not JSON */
  }
  return 'jsonl';
}

/** Read one file into raw item objects. */
export function readRawItems(file, format = 'auto') {
  const text = readText(file);
  const fmt = format === 'auto' ? detectFormat(file, text) : format;
  if (!FORMATS.includes(fmt) && fmt !== 'fhir-ndjson') throw new UserError(`Unknown format "${fmt}" (known: ${FORMATS.join(', ')})`);
  try {
    return parseAs(file, text, fmt);
  } catch (err) {
    if (err instanceof UserError) throw err;
    // Malformed JSON or a FHIR resource with the wrong shape: say which file, not a stack trace.
    throw new UserError(`${file} cannot be read as ${fmt}: ${err.message}`);
  }
}

function parseAs(file, text, fmt) {
  const warnings = [];
  let raw;
  switch (fmt) {
    case 'jsonl':
      raw = parseJsonl(text, file);
      break;
    case 'json': {
      const obj = JSON.parse(text);
      raw = Array.isArray(obj) ? obj : obj && Array.isArray(obj.items) ? obj.items : null;
      if (!raw) throw new UserError(`${file}: expected a JSON array of items or {"items": [...]}`);
      break;
    }
    case 'csv':
      raw = csvToRawItems(text);
      break;
    case 'fhir': {
      const r = fhirToRawItems(JSON.parse(text));
      raw = r.items;
      warnings.push(...r.warnings);
      break;
    }
    case 'fhir-ndjson': {
      const r = fhirToRawItems(parseJsonl(text, file));
      raw = r.items;
      warnings.push(...r.warnings);
      break;
    }
    case 'hl7': {
      const r = hl7ToRawItems(text);
      raw = r.items;
      warnings.push(...r.warnings);
      break;
    }
    case 'github-json': {
      const arr = JSON.parse(text);
      raw = arr.map((i) => issueToRawItem(i, { owner: 'local', repo: path.basename(file) }));
      break;
    }
    default:
      throw new UserError(`Unknown format "${fmt}" (known: ${FORMATS.join(', ')})`);
  }
  return { raw, format: fmt, warnings };
}

/** Load items from a file or a directory of supported files (sorted by name). */
export function loadItems(target, { format = 'auto' } = {}) {
  if (!fs.existsSync(target)) throw new UserError(`Input not found: ${target}`);
  const stat = fs.statSync(target);
  const files = stat.isDirectory()
    ? fs
        .readdirSync(target)
        .filter((f) => SUPPORTED_EXT.has(path.extname(f).toLowerCase()))
        .sort()
        .map((f) => path.join(target, f))
    : [target];
  const raw = [];
  const warnings = [];
  const formats = new Set();
  for (const f of files) {
    const r = readRawItems(f, format);
    raw.push(...r.raw);
    warnings.push(...r.warnings.map((w) => `${path.basename(f)}: ${w}`));
    formats.add(r.format);
  }
  return { items: normalizeItems(raw, 'item'), warnings, formats: [...formats], files };
}
