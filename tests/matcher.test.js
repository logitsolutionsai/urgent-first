import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, compileAbbreviations, normalizeWord, editDistance, compileTerm } from '../src/match/text.js';
import { check, miniPack, item } from './helpers.js';
import { prepareItem, evaluate } from '../src/match/conditions.js';

test('tokenizer keeps exact offsets and expands abbreviations onto the original span', () => {
  const abbr = compileAbbreviations({ SOB: 'shortness of breath', LKW: 'last known well' });
  const text = 'Pt SOB since LKW 0740, r/o PE?';
  const toks = tokenize(text, abbr);
  const sob = toks.filter((t) => t.abbr === 'SOB');
  assert.deepEqual(sob.map((t) => t.t), ['shortness', 'of', 'breath']);
  for (const t of sob) assert.equal(text.slice(t.s, t.e), 'SOB');
  const ro = toks.filter((t) => t.abbr === 'r/o');
  assert.deepEqual(ro.map((t) => t.t), ['rule', 'out']);
  assert.equal(toks[toks.length - 1].k, 'q');
});

test('upper-case abbreviation keys are case-sensitive; lower-case keys are not', () => {
  const abbr = compileAbbreviations({ PE: 'pulmonary embolism', 'nec fasc': 'necrotising fasciitis' });
  assert.ok(tokenize('r/o PE', abbr).some((t) => t.t === 'embolism'));
  assert.ok(!tokenize('pe class today', abbr).some((t) => t.t === 'embolism'));
  assert.ok(tokenize('?Nec Fasc thigh', abbr).some((t) => t.t === 'fasciitis'));
});

test('spelling variants fold together', () => {
  assert.equal(normalizeWord('haemorrhage'), normalizeWord('hemorrhage'));
  assert.equal(normalizeWord('anaesthesia'), normalizeWord('anesthesia'));
  assert.equal(normalizeWord('ischaemic'), normalizeWord('ischemic'));
  assert.equal(normalizeWord('oesophagus'), normalizeWord('esophagus'));
  assert.equal(normalizeWord('necrotising'), normalizeWord('necrotizing'));
  assert.equal(normalizeWord("patient's"), 'patient');
});

test('edit distance counts a transposition as one edit', () => {
  assert.equal(editDistance('pneumothorax', 'pnuemothorax'), 1);
  assert.equal(editDistance('embolism', 'embolsim'), 1);
  assert.equal(editDistance('dissection', 'disection'), 1);
  assert.equal(editDistance('stroke', 'strike'), 1);
  assert.ok(editDistance('security', 'securely') > 1);
});

test('terms match on word boundaries, plurals, prefixes and single-word wildcards', () => {
  assert.equal(check({ terms: ['crash'] }, 'it crashes every time').ok, true);
  assert.equal(check({ terms: ['crash'] }, 'a crashcourse in docs').ok, false);
  assert.equal(check({ terms: ['dissect*'] }, 'dissecting aneurysm').ok, true);
  assert.equal(check({ terms: ['worst headache of * life'] }, 'worst headache of her life').ok, true);
  assert.equal(check({ terms: ['data loss'] }, 'data-loss after upgrade').ok, true, 'hyphen and space are equivalent');
  assert.equal(check({ terms: ['data loss'] }, 'data. Loss').ok, false, 'phrases do not cross a sentence end');
  const pattern = compileTerm('dissect*');
  assert.deepEqual(pattern, [{ t: 'dissect', prefix: true }]);
});

test('spelling-tolerant matching applies only to long words and is marked', () => {
  const r = check({ terms: ['pneumothorax'] }, '?pnuemothorax after line');
  assert.equal(r.ok, true);
  assert.equal(r.evidence[0].fuzzy, true);
  assert.equal(r.evidence[0].text, '?pnuemothorax');
  assert.equal(check({ terms: ['stroke'] }, 'head strike on the door').ok, false, 'short words are not fuzzy-matched');
  assert.equal(check({ terms: ['pneumothorax'], typos: false }, 'pnuemothorax').ok, false);
});

// The negation and suspicion table. Each row: sentence, term, expected context or null for no hit.
const CONTEXT_TABLE = [
  ['No history of stroke, routine follow-up.', 'stroke', 'negated'],
  ['Denies chest pain.', 'chest pain', 'negated'],
  ['CT head without contrast', 'contrast', 'negated'],
  ['Negative for DVT on duplex 2 weeks ago.', 'deep vein thrombosis', 'negated'],
  ['PE ruled out on CTPA in July.', 'pulmonary embolism', 'negated'],
  ['Pneumothorax resolved on last film.', 'pneumothorax', 'negated'],
  ['No trauma, sudden onset worst headache.', 'worst headache', 'affirmed'],
  ['Not peritonitic.', 'peritonitic', 'negated'],
  ['Could not find her words for 10 minutes.', 'find her words', 'affirmed'],
  ['Has not passed urine since this morning.', 'passed urine', 'affirmed'],
  ['r/o PE', 'pulmonary embolism', 'suspected'],
  ['rule out PE, d-dimer raised', 'pulmonary embolism', 'suspected'],
  ['?SAH', 'subarachnoid haemorrhage', 'suspected'],
  ['? SAH after collapse', 'subarachnoid haemorrhage', 'suspected'],
  ['data loss?', 'data loss', 'suspected'],
  ['Query cauda equina.', 'cauda equina', 'suspected'],
  ['Concern for aortic dissection.', 'aortic dissection', 'suspected'],
  ['Suspected torsion.', 'torsion', 'suspected'],
  ['Cannot exclude perforation.', 'perforation', 'suspected'],
  ['Perforation cannot be excluded.', 'perforation', 'suspected'],
  ['Dissection not excluded.', 'dissection', 'suspected'],
  ['No pneumothorax but cannot rule out tension pneumothorax', 'tension pneumothorax', 'suspected'],
  ['PE unlikely, Wells 1, please CTPA', 'pulmonary embolism', 'suspected'],
  ['h/o SAH 2015, coiled.', 'subarachnoid haemorrhage', 'historical'],
  ['Prior PE in 2021.', 'pulmonary embolism', 'historical'],
  ['Family history of aneurysm: mother and sister had subarachnoid bleeds.', 'subarachnoid', 'historical'],
  ['Heat stroke 2019, now well.', 'stroke', 'historical'],
  ['Chronic back pain with new urinary retention', 'urinary retention', 'affirmed'],
  ['h/o DVT 2019, now swollen calf', 'swollen calf', 'affirmed'],
  ['3 week old baby vomiting green', 'vomiting', 'affirmed'],
  ['Not improving on antibiotics, spreading redness', 'spreading redness', 'affirmed'],
  ['No longer able to walk.', 'able to walk', 'affirmed'],
  ['Non-bilious vomiting.', 'bilious', 'negated'],
  ['This is not a security issue.', 'security issue', 'negated'],
  ['Scanner reports a CVE in the zip library (confirmed false positive)', 'CVE', 'negated'],
  ['no crash, no corruption, nothing missing', 'missing', 'negated'],
  ['No response from the server and all my files got wiped', 'wiped', 'affirmed'],
  ['battery packet found intact', 'battery', 'negated'],
];

test('negation, suspicion and history scopes: tricky sentence table', () => {
  const abbreviations = { PE: 'pulmonary embolism', SAH: 'subarachnoid haemorrhage', DVT: 'deep vein thrombosis' };
  for (const [sentence, term, expected] of CONTEXT_TABLE) {
    const r = check({ terms: [term], include: ['affirmed', 'suspected', 'historical', 'negated'] }, sentence, { abbreviations });
    assert.ok(r.evidence.length > 0, `no hit for "${term}" in "${sentence}"`);
    assert.equal(r.evidence[0].context, expected, `"${term}" in "${sentence}"`);
  }
});

test('by default negated and historical mentions do not count but suspected ones do', () => {
  const abbreviations = { PE: 'pulmonary embolism' };
  assert.equal(check({ terms: ['pulmonary embolism'] }, 'PE ruled out', { abbreviations }).ok, false);
  assert.equal(check({ terms: ['pulmonary embolism'] }, 'Prior PE in 2021', { abbreviations }).ok, false);
  assert.equal(check({ terms: ['pulmonary embolism'] }, 'r/o PE', { abbreviations }).ok, true);
  const r = check({ terms: ['pulmonary embolism'] }, 'PE ruled out', { abbreviations });
  assert.equal(r.suppressed.length, 1, 'suppressed mentions are kept for review');
  assert.equal(r.suppressed[0].context, 'negated');
});

test('a suspected mention quotes its cue', () => {
  const r = check({ terms: ['pulmonary embolism'] }, 'Reason: r/o PE today', { abbreviations: { PE: 'pulmonary embolism' } });
  assert.equal(r.evidence[0].text, 'r/o PE');
});

test('near pairs words in one sentence and judges each part', () => {
  const cond = { near: [['lost', 'deleted'], ['projects', 'files']], within: 4 };
  const r = check(cond, 'I lost all my saved projects yesterday');
  assert.equal(r.ok, true);
  assert.equal(r.evidence[0].text, 'lost all my saved projects');
  assert.equal(check(cond, 'I lost. My projects are fine').ok, false, 'not across a sentence end');
  assert.equal(check(cond, 'lost one, two, three, four, five, six projects').ok, false, 'not across commas');
  assert.equal(check({ near: [['startup'], ['crash']], within: 3 }, 'warning on startup (no crash)').ok, false);
});

test('except phrases remove look-alikes without removing real mentions', () => {
  const cond = { terms: ['stroke'], except: ['stroke volume', 'heat stroke'] };
  assert.equal(check(cond, 'quantify LV stroke volume').ok, false);
  assert.equal(check(cond, 'heat stroke as a child; new stroke today').ok, true);
});

test('regex conditions quote the matched text and respect negation', () => {
  assert.equal(check({ regex: '#\\s?NOF' }, 'Fall, ?# NOF').evidence[0].text, '# NOF');
  assert.equal(check({ regex: 'crash(?:es|ed)?' }, 'no crash on startup').ok, false);
});

test('all / any / none combinators', () => {
  const cond = { all: [{ terms: ['back'] }, { any: [{ terms: ['retention'] }, { terms: ['saddle'] }] }, { none: [{ terms: ['chronic stable'] }] }] };
  assert.equal(check(cond, 'back pain with saddle numbness').ok, true);
  assert.equal(check(cond, 'back pain only').ok, false);
  assert.equal(check(cond, 'back pain with retention, chronic stable').ok, false);
});

test('field conditions on location, labels and metadata quote the field value', () => {
  const pack = miniPack([{ match: { all: [{ field: 'location', in: ['ED'] }, { field: 'labels', matches: ['security'] }] } }]);
  const it = item('text', { location: 'ED', labels: ['bug', 'type: security'] });
  const r = evaluate(pack.rules[0].match, prepareItem(it, pack), 'R1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.evidence.map((e) => [e.field, e.text]), [['location', 'ED'], ['labels[1]', 'type: security']]);
  const num = evaluate({ field: 'metadata.reactions', op: '>=', value: 10 }, prepareItem(item('x', { metadata: { reactions: 12 } }), pack), 'R1');
  assert.equal(num.ok, true);
  assert.equal(num.evidence.length, 0, 'numbers have no quotable text');
});

test('version mentions respect version boundaries', () => {
  const pack = miniPack([{ match: { mentions: 'metadata.latest_release_aliases' } }]);
  const run = (text) => evaluate({ mentions: 'metadata.latest_release_aliases' }, prepareItem(item(text, { metadata: { latest_release: 'v3.2.0' } }), pack), 'R1');
  assert.equal(run('broken since 3.2').ok, true);
  assert.equal(run('broken since v3.2.0').ok, true);
  assert.equal(run('fine on 3.2.1').ok, false);
  assert.equal(run('fine on 13.2').ok, false);
  assert.equal(run('fine on 3.20').ok, false);
});
