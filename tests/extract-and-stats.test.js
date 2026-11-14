import test from 'node:test';
import assert from 'node:assert/strict';
import { radiology, item } from './helpers.js';
import { prepareItem, getNumbers, getClocks } from '../src/match/conditions.js';
import { wilson, kendallTauB } from '../src/stats.js';
import { formatMinutes } from '../src/util.js';

const pack = radiology();
const nums = (text, name) => getNumbers(prepareItem(item(text, { priority: 'routine' }), pack), name).map((n) => n.value);
const clocks = (text, created) => getClocks(prepareItem(item(text, { priority: 'routine', created_at: created }), pack), 'onset');

test('numbers: SpO2, heart rate, blood pressure, GCS and temperature', () => {
  assert.deepEqual(nums('SpO2 88% on room air', 'spo2'), [88]);
  assert.deepEqual(nums('SpO2 down from 95% to 87% on room air', 'spo2'), [87]);
  assert.deepEqual(nums('sats 92%, oxygen saturation 93% on air', 'spo2'), [92, 93]);
  assert.deepEqual(nums('HR now 124, pulse 90', 'hr'), [124, 90]);
  assert.deepEqual(nums('heart rate in clinic today is 112', 'hr'), [112]);
  assert.deepEqual(nums('BP falling from 150/90 to 96/60', 'sbp'), [96]);
  assert.deepEqual(nums('BP 82/50', 'sbp'), [82]);
  assert.ok(nums('GCS 15 on arrival, now 12.', 'gcs').includes(12));
  assert.deepEqual(nums('GCS 14 (confused) on arrival and still 14 now at 20:35', 'gcs').filter((v) => v > 15), [], 'a clock time is not a GCS');
  assert.deepEqual(nums('T 38.4, fever to 39.1', 'temp'), [38.4, 39.1]);
});

test('clocks: wall times, compact times, durations ago, previous day and offsets', () => {
  const a = clocks('LKW 07:40, left arm weak', '2026-04-07T09:10:00Z');
  assert.equal(a.length, 1);
  assert.equal(a[0].elapsedMinutes, 90);
  assert.equal(new Date(a[0].eventMs).toISOString(), '2026-04-07T07:40:00.000Z');

  assert.equal(clocks('last known well 0740', '2026-04-07T09:10:00Z')[0].elapsedMinutes, 90);
  assert.equal(clocks('symptoms started 2 hours ago', '2026-04-07T09:10:00Z')[0].elapsedMinutes, 120);
  assert.equal(clocks('onset 45 min ago', '2026-04-07T09:10:00Z')[0].elapsedMinutes, 45);

  const overnight = clocks('woke with weakness, last seen normal 23:00', '2026-04-07T06:30:00Z');
  assert.equal(overnight[0].elapsedMinutes, 450, '23:00 the previous evening');

  const offset = clocks('LKW 07:40', '2026-04-07T09:10:00+02:00');
  assert.equal(offset[0].elapsedMinutes, 90, 'wall time read in the item\'s own offset');
  assert.equal(new Date(offset[0].eventMs).toISOString(), '2026-04-07T05:40:00.000Z');

  assert.equal(clocks('no clock here, since 2019', '2026-04-07T09:10:00Z').length, 0);
});

test('duration formatting', () => {
  assert.equal(formatMinutes(45), '45 min');
  assert.equal(formatMinutes(95), '1 h 35 min');
  assert.equal(formatMinutes(1440), '1 d');
  assert.equal(formatMinutes(-30), '-30 min');
});

test('Wilson interval matches hand-computed values', () => {
  // x = n: lower bound = n / (n + z^2).
  const z2 = 1.959963984540054 ** 2;
  const w80 = wilson(80, 80);
  assert.ok(Math.abs(w80.lower - 80 / (80 + z2)) < 1e-12);
  assert.equal(w80.upper, 1);
  assert.ok(w80.lower > 0.95, '80 of 80 gives a lower bound above 95%');
  assert.ok(wilson(72, 72).lower < 0.95, '72 of 72 does not (73 is the smallest n that does)');
  assert.ok(wilson(73, 73).lower >= 0.95);
  // 8 of 10, computed by hand: p = 0.8, centre = (0.8 + 0.192073)/1.384146 = 0.716741,
  // half = 1.959964 * sqrt(0.016 + 0.009604) / 1.384146 = 0.226562 -> [0.4902, 0.9433].
  const w = wilson(8, 10);
  assert.ok(Math.abs(w.lower - 0.4902) < 1e-4, `lower ${w.lower}`);
  assert.ok(Math.abs(w.upper - 0.9433) < 1e-4, `upper ${w.upper}`);
  assert.deepEqual(wilson(0, 0), { p: null, lower: null, upper: null });
});

test('Kendall tau-b matches hand-computed values', () => {
  assert.equal(kendallTauB([1, 2, 3, 4], [1, 2, 3, 4]), 1);
  assert.equal(kendallTauB([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  // x = [1,2,3,4], y = [1,3,2,4]: 5 concordant, 1 discordant, no ties -> (5-1)/6.
  assert.ok(Math.abs(kendallTauB([1, 2, 3, 4], [1, 3, 2, 4]) - 4 / 6) < 1e-12);
  // Ties: x = [1,2,3,4], y = [1,1,2,2]: pairs (1,2) and (3,4) tied in y. C = 4, D = 0, n0 = 6, ties_y = 2.
  // tau_b = 4 / sqrt(6 * 4) = 0.8165.
  assert.ok(Math.abs(kendallTauB([1, 2, 3, 4], [1, 1, 2, 2]) - 4 / Math.sqrt(24)) < 1e-12);
  assert.equal(kendallTauB([1, 1], [1, 1]), null);
});
