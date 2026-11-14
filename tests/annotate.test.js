import test from 'node:test';
import assert from 'node:assert/strict';
import { triage } from '../src/engine.js';
import { mergeAnnotations, validateAnnotations, reviewTemplate } from '../src/annotate.js';
import { normalizeItems } from '../src/items.js';
import { renderMarkdown } from '../src/render/markdown.js';
import { radiology } from './helpers.js';

const rad = radiology();
const items = normalizeItems([
  { id: 'a', title: 'MRI lumbar spine', text: { reason: 'Back pain. Says he cannot feel the seat when cycling and his stream is weak.' }, priority: 'routine', synthetic: true },
  { id: 'b', title: 'CT head', text: { reason: 'Sudden L facial droop' }, priority: 'routine', synthetic: true },
  { id: 'c', title: 'XR knee', text: { reason: 'Chronic knee pain' }, priority: 'urgent', synthetic: true },
]);
const itemsById = new Map(items.map((i) => [i.id, i]));
const base = triage(items, rad, { now: '2026-04-07T12:00:00Z' });
const resultsById = new Map(base.items.map((r) => [r.id, r]));
const validate = (anns) => validateAnnotations(anns, { pack: rad, itemsById, resultsById });

test('a valid annotation is accepted and its quote becomes an evidence span', () => {
  const { accepted, rejected } = validate([{ item_id: 'a', raise_to: 'T1', rule_id: 'CAUDA-EQUINA', reason: 'Saddle numbness described in plain words.', quotes: ['cannot feel the seat when cycling'] }]);
  assert.equal(rejected.length, 0);
  assert.equal(accepted[0].evidence[0].field, 'reason');
  assert.equal(items[0].text.reason.slice(accepted[0].evidence[0].start, accepted[0].evidence[0].end), 'cannot feel the seat when cycling');
});

test('quote-or-reject: paraphrases, changed case, short and missing quotes are rejected', () => {
  const cases = [
    [{ item_id: 'a', raise_to: 'T1', rule_id: 'LLM', reason: 'x', quotes: ['cannot feel the saddle'] }, /not found verbatim/],
    [{ item_id: 'a', raise_to: 'T1', rule_id: 'LLM', reason: 'x', quotes: ['Cannot feel the seat'] }, /not found verbatim/],
    [{ item_id: 'a', raise_to: 'T1', rule_id: 'LLM', reason: 'x', quotes: ['is'] }, /too short/],
    [{ item_id: 'a', raise_to: 'T1', rule_id: 'LLM', reason: 'x', quotes: [] }, /no quotes/],
    [{ item_id: 'a', raise_to: 'T1', rule_id: 'LLM', reason: 'x' }, /no quotes/],
    [{ item_id: 'a', raise_to: 'T1', rule_id: 'LLM', reason: '', quotes: ['Back pain'] }, /missing reason/],
  ];
  for (const [ann, re] of cases) {
    const { rejected } = validate([ann]);
    assert.equal(rejected.length, 1, JSON.stringify(ann));
    assert.match(rejected[0].reasons.join('; '), re);
  }
});

test('raise-only: an annotation that lowers a tier is rejected', () => {
  const { rejected } = validate([{ item_id: 'b', raise_to: 'T3', rule_id: 'LLM', reason: 'looks old', quotes: ['facial droop'] }]);
  assert.match(rejected[0].reasons.join(';'), /would lower T1 to T3/);
  const floorCase = validate([{ item_id: 'c', raise_to: 'T3', rule_id: 'LLM', reason: 'chronic', quotes: ['Chronic knee pain'] }]);
  assert.match(floorCase.rejected[0].reasons.join(';'), /would lower T2 to T3/, 'cannot go under the ordered priority');
});

test('unknown items, tiers and rules are rejected, and a rule must use its own tier', () => {
  const r1 = validate([{ item_id: 'zzz', raise_to: 'T1', rule_id: 'LLM', reason: 'x', quotes: ['Back pain'] }]);
  assert.match(r1.rejected[0].reasons.join(';'), /unknown item_id/);
  const r2 = validate([{ item_id: 'a', raise_to: 'T0', rule_id: 'LLM', reason: 'x', quotes: ['Back pain'] }]);
  assert.match(r2.rejected[0].reasons.join(';'), /unknown tier/);
  const r3 = validate([{ item_id: 'a', raise_to: 'T1', rule_id: 'MADE-UP', reason: 'x', quotes: ['Back pain'] }]);
  assert.match(r3.rejected[0].reasons.join(';'), /unknown rule_id/);
  const r4 = validate([{ item_id: 'a', raise_to: 'T2', rule_id: 'CAUDA-EQUINA', reason: 'x', quotes: ['Back pain'] }]);
  assert.match(r4.rejected[0].reasons.join(';'), /does not match rule CAUDA-EQUINA's tier T1/);
});

test('merge raises the item, re-sorts the board, lists rejections, and is repeatable', () => {
  const anns = [
    { item_id: 'a', raise_to: 'T1', rule_id: 'CAUDA-EQUINA', reason: 'Saddle numbness and weak stream described in plain words.', quotes: ['cannot feel the seat when cycling', 'his stream is weak'] },
    { item_id: 'c', raise_to: 'T1', rule_id: 'LLM', reason: 'invented', quotes: ['knee is hot and swollen'] },
  ];
  const merged = mergeAnnotations(base, rad, anns, itemsById);
  const a = merged.items.find((r) => r.id === 'a');
  assert.equal(a.tier, 'T1');
  assert.equal(a.annotations[0].applied, true);
  assert.equal(merged.annotations.rejected, 1);
  assert.equal(merged.items.find((r) => r.id === 'c').tier, 'T2');
  const md = renderMarkdown(merged, { pack: rad });
  assert.match(md, /## Rejected Annotations \(1\)/);
  assert.match(md, /quote not found verbatim/);
  const again = mergeAnnotations(base, rad, anns, itemsById);
  assert.equal(JSON.stringify(again), JSON.stringify(merged));
  assert.equal(base.items.find((r) => r.id === 'a').tier, 'T3', 'the rules-only result is not mutated');
});

test('the review template lists unmatched and ambiguous items with the contract', () => {
  const tpl = reviewTemplate(base, itemsById, rad, { guidePath: 'packs/radiology-research/review.md' });
  const ids = tpl.rows.map((r) => r.item_id);
  assert.ok(ids.includes('a'));
  assert.ok(!ids.includes('b'));
  assert.match(tpl.markdown, /exact, case-sensitive substrings/);
  assert.match(tpl.markdown, /Research and education software/);
  assert.doesNotMatch(tpl.markdown, /safe to wait|can wait list/i);
});
