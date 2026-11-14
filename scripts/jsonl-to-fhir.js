#!/usr/bin/env node
// Convert synthetic JSONL orders into a FHIR R4 Bundle of ServiceRequests (with Encounters for the
// location), marked as test data with meta.security HTEST. Gold labels are dropped.
// Usage: node scripts/jsonl-to-fhir.js <in.jsonl> <out.json> [--limit N]
import fs from 'node:fs';
import { readJsonl } from '../src/util.js';

const [inFile, outFile, ...rest] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('Usage: node scripts/jsonl-to-fhir.js <in.jsonl> <out.json> [--limit N]');
  process.exit(1);
}
const li = rest.indexOf('--limit');
const limit = li >= 0 ? Number(rest[li + 1]) : Infinity;
const CLASS = { ED: 'EMER', inpatient: 'IMP', ICU: 'ACUTE', outpatient: 'AMB' };
const entries = [];
for (const row of readJsonl(inFile).slice(0, limit)) {
  if (!row.synthetic) throw new Error(`${row.id} is not marked synthetic`);
  const encId = `enc-${row.id}`;
  const code = CLASS[row.location] || 'AMB';
  entries.push({ fullUrl: `urn:uuid:${encId}`, resource: { resourceType: 'Encounter', id: encId, status: 'in-progress', class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code } } });
  const t = row.text || {};
  const reasonParts = [t.reason, t.history].filter(Boolean);
  entries.push({
    fullUrl: `urn:uuid:${row.id}`,
    resource: {
      resourceType: 'ServiceRequest',
      id: row.id,
      status: 'active',
      intent: 'order',
      priority: row.priority,
      code: { text: row.title },
      encounter: { reference: `urn:uuid:${encId}` },
      authoredOn: row.created_at,
      reasonCode: reasonParts.map((text) => ({ text })),
      ...(t.note ? { note: [{ text: t.note }] } : {}),
    },
  });
}
const bundle = {
  resourceType: 'Bundle',
  type: 'collection',
  meta: { security: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HTEST', display: 'test health data' }] },
  entry: entries,
};
fs.writeFileSync(outFile, JSON.stringify(bundle, null, 1) + '\n');
console.log(`wrote ${entries.length / 2} ServiceRequests to ${outFile}`);
