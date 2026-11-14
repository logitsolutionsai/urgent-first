// CSV adapter (RFC 4180 quoting). Column mapping:
//   id, title, priority, labels (separated by ";"), created_at, location, source, url, synthetic,
//   text (single text field) or text.<name> (named text fields), metadata.<name> (numbers parsed),
//   gold.tier, gold.category, gold.rationale, gold.rank (labelled files).
import { UserError } from '../util.js';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      field = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) throw new UserError('CSV: unterminated quoted field');
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

function coerce(v) {
  if (v === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

export function csvToRawItems(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  if (!header.includes('id')) throw new UserError('CSV: header must include an "id" column');
  return rows.slice(1).map((cells, r) => {
    if (cells.length !== header.length) throw new UserError(`CSV row ${r + 2}: expected ${header.length} cells, got ${cells.length}`);
    const item = { text: {}, metadata: {} };
    header.forEach((h, c) => {
      const v = cells[c];
      if (h === 'labels') item.labels = v ? v.split(';').map((s) => s.trim()).filter(Boolean) : [];
      else if (h === 'synthetic') item.synthetic = /^(true|1|yes)$/i.test(v.trim());
      else if (h === 'text') item.text.text = v;
      else if (h.startsWith('text.')) item.text[h.slice(5)] = v;
      else if (h.startsWith('metadata.')) item.metadata[h.slice(9)] = coerce(v);
      else if (h.startsWith('gold.')) {
        item.gold = item.gold || {};
        item.gold[h.slice(5)] = h === 'gold.rank' ? coerce(v) : v;
      } else item[h] = v === '' ? null : v;
    });
    return item;
  });
}
