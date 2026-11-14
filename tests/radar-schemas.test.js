// The committed demo outputs and freshly generated ones validate against schema/*.v1.schema.json, and the
// schemas reject what they must reject (a node with a tier, a Pulse entry with item text, a bad decision).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { validate } from '../src/jsonschema.js';
import { initReview } from '../src/review/review.js';

const schema = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', `${n}.v1.schema.json`), 'utf8'));
const EX = path.join(ROOT, 'examples', 'release-pulse');
const read = (...p) => JSON.parse(fs.readFileSync(path.join(EX, ...p), 'utf8'));

test('demo snapshots, graphs, Pulse and a review template validate against their schemas', () => {
  for (const v of ['v3.1', 'v3.2']) {
    const snap = read('snapshots', v, 'snapshot.json');
    assert.deepEqual(validate(schema('snapshot'), snap), [], `snapshot ${v}`);
    const graph = read('snapshots', v, 'evidence-graph.json');
    assert.deepEqual(validate(schema('evidence-graph'), graph), [], `graph ${v}`);
    assert.deepEqual(validate(schema('review'), initReview(snap, graph)), [], `review ${v}`);
  }
  assert.deepEqual(validate(schema('pulse'), read('pulse', 'pulse.json')), []);
});

test('the schemas reject a node with a tier, a Pulse entry with item text, and an unknown decision', () => {
  const graph = read('snapshots', 'v3.2', 'evidence-graph.json');
  const g = structuredClone(graph);
  g.nodes[0].tier = 'T1';
  assert.ok(validate(schema('evidence-graph'), g).length > 0);
  const p = read('pulse', 'pulse.json');
  p.sections.newlyFlagged[0].text = { body: 'x' };
  assert.ok(validate(schema('pulse'), p).length > 0);
  const snap = read('snapshots', 'v3.2', 'snapshot.json');
  const r = initReview(snap, graph);
  r.decisions[0].decision = 'duplicate';
  assert.ok(validate(schema('review'), r).length > 0);
  const r2 = initReview(snap, graph);
  r2.decisions.push({ target: '#717', kind: 'triage', decision: 'missed_raise' });
  assert.ok(validate(schema('review'), r2).length > 0, 'missed_raise needs suggestedTier and quotes');
});
