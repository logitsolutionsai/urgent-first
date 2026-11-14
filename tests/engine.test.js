import test from 'node:test';
import assert from 'node:assert/strict';
import { triage, computeFloor } from '../src/engine.js';
import { mergeAnnotations } from '../src/annotate.js';
import { normalizeItems } from '../src/items.js';
import { tierRank } from '../src/pack.js';
import { seededRandom } from '../src/util.js';
import { radiology, github, miniPack } from './helpers.js';

const NOW = '2026-04-07T12:00:00Z';

test('floor comes from the priority field and maintainer labels', () => {
  const rad = radiology();
  const items = normalizeItems([
    { id: 'a', title: 'XR chest', text: { reason: 'routine check' }, priority: 'STAT', synthetic: true },
    { id: 'b', title: 'XR chest', text: { reason: 'routine check' }, priority: 'urgent', synthetic: true },
  ]);
  assert.equal(computeFloor(items[0], rad).tier, 'T1', 'case-insensitive');
  assert.equal(computeFloor(items[1], rad).tier, 'T2');
  const gh = github();
  const it = normalizeItems([{ id: '#1', title: 'docs', text: { body: 'typo' }, labels: ['type: security'] }])[0];
  const f = computeFloor(it, gh);
  assert.equal(f.tier, 'T1');
  assert.equal(f.reasons[0].evidence[0].field, 'labels[0]');
});

test('the radiology pack refuses a missing or unknown priority instead of guessing', () => {
  const rad = radiology();
  const items = normalizeItems([
    { id: 'a', title: 'CT head', text: { reason: 'headache' }, synthetic: true },
    { id: 'b', title: 'CT head', text: { reason: 'headache' }, priority: 'high', synthetic: true },
  ]);
  assert.throws(() => triage(items, rad, { now: NOW }), (err) => {
    assert.match(err.message, /failed validation/);
    assert.ok(err.details.some((d) => d.startsWith('a: missing priority')));
    assert.ok(err.details.some((d) => d.startsWith('b: unknown priority')));
    return true;
  });
});

test('a rule can raise a stat-floor item no further and never lowers it', () => {
  const rad = radiology();
  const items = normalizeItems([{ id: 'a', title: 'MRI brain', text: { reason: 'Annual review, unchanged, no new symptoms.' }, priority: 'stat', synthetic: true }]);
  const r = triage(items, rad, { now: NOW }).items[0];
  assert.equal(r.tier, 'T1');
  assert.equal(r.rules.length, 0);
  assert.equal(r.floor.reasons[0].evidence[0].text, 'stat');
});

test('ordering: tier, then earliest deadline, then longest wait, then original order', () => {
  const pack = miniPack([{ id: 'HOT', match: { terms: ['hot'] } }, { id: 'WARM', tier: 'T2', match: { terms: ['warm'] } }]);
  const items = normalizeItems([
    { id: 'u1', text: 'nothing', created_at: '2026-04-07T08:00:00Z' },
    { id: 'w1', text: 'warm', created_at: '2026-04-07T07:00:00Z' },
    { id: 'h-late', text: 'hot', created_at: '2026-04-07T10:00:00Z' },
    { id: 'h-early', text: 'hot', created_at: '2026-04-07T09:00:00Z' },
    { id: 'u2', text: 'nothing else', created_at: '2026-04-07T06:00:00Z' },
    { id: 'h-notime', text: 'hot' },
  ]);
  const order = triage(items, pack, { now: NOW }).items.map((r) => r.id);
  assert.deepEqual(order, ['h-early', 'h-late', 'h-notime', 'w1', 'u1', 'u2']);
});

test('same input gives byte-identical output (determinism)', () => {
  const rad = radiology();
  const raw = [
    { id: 'a', title: 'CT head', text: { reason: 'Sudden L arm weakness, LKW 07:40' }, priority: 'routine', created_at: '2026-04-07T09:00:00Z', synthetic: true },
    { id: 'b', title: 'CTPA', text: { reason: 'r/o PE, HR 120' }, priority: 'urgent', created_at: '2026-04-07T08:00:00Z', synthetic: true },
    { id: 'c', title: 'MRI knee', text: { reason: 'chronic pain' }, priority: 'routine', created_at: '2026-04-07T07:00:00Z', synthetic: true },
  ];
  const one = JSON.stringify(triage(normalizeItems(raw), rad, { now: NOW }));
  const two = JSON.stringify(triage(normalizeItems(structuredClone(raw)), rad, { now: NOW }));
  assert.equal(one, two);
  const later = triage(normalizeItems(raw), rad, { now: '2026-04-08T00:00:00Z' });
  assert.deepEqual(later.items.map((r) => r.id), JSON.parse(one).items.map((r) => r.id), 'order does not depend on now');
});

test('clocks are attached only for rules that use them', () => {
  const rad = radiology();
  const items = normalizeItems([
    { id: 'stroke', title: 'CT head', text: { reason: 'Facial droop since 08:10' }, priority: 'routine', created_at: '2026-04-07T09:00:00Z', synthetic: true },
    { id: 'baby', title: 'US abdomen', text: { reason: 'Green vomit since 08:10' }, priority: 'routine', created_at: '2026-04-07T09:00:00Z', synthetic: true },
  ]);
  const res = triage(items, rad, { now: NOW });
  const byId = Object.fromEntries(res.items.map((r) => [r.id, r]));
  assert.equal(byId.stroke.clocks.length, 1);
  assert.equal(byId.stroke.clocks[0].windows[0].remaining_minutes_at_item_time, 220);
  assert.equal(byId.baby.tier, 'T1');
  assert.equal(byId.baby.clocks.length, 0);
});

test('every flag carries evidence that is an exact substring of the item', () => {
  const rad = radiology();
  const raw = [
    { id: 'a', title: 'CT head', text: { reason: '?SAH. Thunderclap HA 1hr ago. GCS 15', history: 'On apixaban (DOAC).' }, priority: 'urgent', synthetic: true },
    { id: 'b', title: 'MRI L spine', text: { reason: 'r/o cauda equina. Known L4/5 disc. Numb in both legs, new faecal incontinence x1' }, priority: 'routine', synthetic: true },
  ];
  const items = normalizeItems(raw);
  const res = triage(items, rad, { now: NOW });
  for (const r of res.items) {
    const it = items.find((x) => x.id === r.id);
    assert.ok(r.rules.length > 0);
    for (const rule of r.rules) {
      assert.ok(rule.evidence.length > 0, `${rule.id} has evidence`);
      for (const e of rule.evidence) {
        const src = e.field === 'title' ? it.title : it.text[e.field];
        assert.equal(src.slice(e.start, e.end), e.text);
      }
    }
  }
});

// Property test: random items and random annotations never end below their floor.
test('raise-only invariant holds for random items and random annotations', () => {
  const rad = radiology();
  const rand = seededRandom(424242);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const phrases = ['routine follow-up', 'no history of stroke', 'r/o PE', 'sudden facial droop', 'denies saddle anaesthesia', 'free air?', 'known stable aneurysm', 'GCS 11 after fall', 'green vomit in a 3 day old', 'heat stroke 2019', 'PE ruled out', 'SpO2 86%'];
  const priorities = ['routine', 'urgent', 'asap', 'stat'];
  const tiers = ['T1', 'T2', 'T3', 'T0', 'X'];
  for (let round = 0; round < 60; round++) {
    const raw = Array.from({ length: 12 }, (_, i) => ({
      id: `r${round}-${i}`,
      title: 'CT',
      text: { reason: `${pick(phrases)}. ${pick(phrases)}` },
      priority: pick(priorities),
      created_at: new Date(Date.UTC(2026, 3, 7, 6 + i)).toISOString(),
      synthetic: true,
    }));
    const items = normalizeItems(raw);
    const rulesOnly = triage(items, rad, { now: NOW });
    for (const r of rulesOnly.items) assert.ok(tierRank(rad, r.tier) <= tierRank(rad, r.floor.tier), `${r.id} below floor`);
    const anns = Array.from({ length: 15 }, () => {
      const it = pick(items);
      const words = it.text.reason.split(' ');
      return { item_id: rand() < 0.1 ? 'nope' : it.id, raise_to: pick(tiers), rule_id: rand() < 0.5 ? 'LLM' : pick(['STROKE', 'TIA', 'MADE-UP']), reason: 'random', quotes: [rand() < 0.2 ? 'invented words' : words.slice(0, 2).join(' ')] };
    });
    const merged = mergeAnnotations(rulesOnly, rad, anns, new Map(items.map((i) => [i.id, i])));
    const before = new Map(rulesOnly.items.map((r) => [r.id, r.tier]));
    for (const r of merged.items) {
      assert.ok(tierRank(rad, r.tier) <= tierRank(rad, r.floor.tier), `${r.id} below floor after merge`);
      assert.ok(tierRank(rad, r.tier) <= tierRank(rad, before.get(r.id)), `${r.id} lowered by merge`);
    }
    assert.equal(merged.annotations.accepted + merged.annotations.rejected, anns.length);
  }
});
