// The item model shared by every adapter.
//
// {
//   id: string (required, unique),
//   title: string,
//   text: { <field>: string },      // named free-text fields, e.g. body, reason, history, note
//   priority: string | null,        // the source system's own priority (FHIR stat/asap/urgent/routine, P1...)
//   labels: string[],
//   created_at: ISO 8601 string | null,
//   location: string | null,        // ED, inpatient, eu-west ...
//   source: string | null,          // system or file the item came from
//   url: string | null,
//   synthetic: boolean,             // required true for research-mode packs
//   metadata: object,               // anything else (numbers, booleans, strings)
//   gold?: { tier, category, rationale, rank? }   // labelled files only
// }

import { UserError, parseTime } from './util.js';

export const RESERVED_FIELDS = new Set(['title', 'priority', 'location', 'labels', 'source', 'url', 'metadata', 'id', 'gold', 'synthetic', 'created_at']);
const FIELD_NAME_RE = /^[a-z][a-z0-9_]{0,40}$/;

function versionAliases(version) {
  if (typeof version !== 'string' || !version.trim()) return [];
  const v = version.trim().replace(/^v/i, '');
  const out = new Set([`v${v}`, v]);
  const parts = v.split('.');
  if (parts.length === 3 && parts[2] === '0') {
    out.add(`${parts[0]}.${parts[1]}`);
    out.add(`v${parts[0]}.${parts[1]}`);
  }
  return [...out];
}

/**
 * Normalise a raw item object. Throws UserError with a precise message on invalid input.
 */
export function normalizeItem(raw, index, label = 'item') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UserError(`${label} ${index + 1}: not an object`);
  const where = `${label} ${index + 1}${raw.id !== undefined ? ` (id ${JSON.stringify(raw.id)})` : ''}`;
  if (raw.id === undefined || raw.id === null || String(raw.id).trim() === '') throw new UserError(`${where}: missing id`);
  const id = String(raw.id).trim();

  let text = {};
  if (typeof raw.text === 'string') text = { text: raw.text };
  else if (raw.text && typeof raw.text === 'object' && !Array.isArray(raw.text)) {
    for (const [k, v] of Object.entries(raw.text)) {
      if (!FIELD_NAME_RE.test(k)) throw new UserError(`${where}: text field name "${k}" must be lowercase letters, digits or _`);
      if (RESERVED_FIELDS.has(k)) throw new UserError(`${where}: text field name "${k}" is reserved`);
      if (v === null || v === undefined) continue;
      if (typeof v !== 'string') throw new UserError(`${where}: text.${k} must be a string`);
      text[k] = v;
    }
  } else if (raw.text !== undefined && raw.text !== null) throw new UserError(`${where}: text must be a string or an object of strings`);

  const title = raw.title === undefined || raw.title === null ? '' : String(raw.title);
  let labels = raw.labels ?? [];
  if (typeof labels === 'string') labels = labels.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(labels)) throw new UserError(`${where}: labels must be an array of strings`);
  labels = labels.map((l) => (typeof l === 'object' && l && l.name ? String(l.name) : String(l)));

  const created = raw.created_at ?? null;
  if (created !== null && created !== '' && parseTime(created) === null) throw new UserError(`${where}: created_at "${created}" is not an ISO 8601 date-time`);

  const priority = raw.priority === undefined || raw.priority === null || String(raw.priority).trim() === '' ? null : String(raw.priority).trim();
  const metadata = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? { ...raw.metadata } : {};
  if (metadata.latest_release && !metadata.latest_release_aliases) metadata.latest_release_aliases = versionAliases(String(metadata.latest_release));

  const item = {
    id,
    title,
    text,
    priority,
    labels,
    created_at: created === '' ? null : created,
    location: raw.location === undefined || raw.location === null || raw.location === '' ? null : String(raw.location),
    source: raw.source === undefined || raw.source === null ? null : String(raw.source),
    url: raw.url === undefined || raw.url === null ? null : String(raw.url),
    synthetic: raw.synthetic === true || metadata.synthetic === true,
    metadata,
  };
  if (raw.gold) item.gold = raw.gold;
  return item;
}

export function normalizeItems(rawItems, label = 'item') {
  const items = rawItems.map((r, i) => normalizeItem(r, i, label));
  const seen = new Map();
  items.forEach((it, i) => {
    if (seen.has(it.id)) throw new UserError(`Duplicate id "${it.id}" (items ${seen.get(it.id) + 1} and ${i + 1})`);
    seen.set(it.id, i);
  });
  return items;
}

/** Names of the searchable text fields of an item: title first, then text fields in insertion order. */
export function textFieldNames(item) {
  return ['title', ...Object.keys(item.text)];
}

/** Value of a field path used in evidence spans. */
export function fieldValue(item, field) {
  if (field === 'title') return item.title;
  if (field === 'priority') return item.priority;
  if (field === 'location') return item.location;
  const lab = /^labels\[(\d+)\]$/.exec(field);
  if (lab) return item.labels[Number(lab[1])];
  if (field.startsWith('metadata.')) {
    const v = item.metadata[field.slice(9)];
    return typeof v === 'string' ? v : undefined;
  }
  return item.text[field];
}

/** All fields a quote may come from, in a stable order. */
export function quotableFields(item) {
  const fields = textFieldNames(item).map((f) => ({ field: f, text: fieldValue(item, f) }));
  if (item.priority) fields.push({ field: 'priority', text: item.priority });
  if (item.location) fields.push({ field: 'location', text: item.location });
  item.labels.forEach((l, i) => fields.push({ field: `labels[${i}]`, text: l }));
  return fields.filter((f) => typeof f.text === 'string' && f.text.length);
}

export function stripGold(item) {
  const { gold, ...rest } = item;
  return rest;
}
