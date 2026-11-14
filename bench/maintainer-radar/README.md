# Maintainer Radar Candidate-Link Benchmark

Labelled pairs of synthetic reports for measuring candidate links (`possible_duplicate` and `same_symptom`). Every item is invented. Run `node scripts/bench-links.js`; it writes `results.json`, and `tests/graph.test.js` fails if the code no longer reproduces it or the README table differs.

## Sets

| Set | Items | Same-problem pairs | Hard negatives | Negation conflicts | Template noise |
| --- | --- | --- | --- | --- | --- |
| Development (`candidates.dev.*`) | 69 | 15 (12 pairs and one group of three) | 10 | 4 | 4 |
| Held-out (`candidates.heldout.*`) | 43 | 8 | 6 | 3 | 3 |

- **Hard positives:** paraphrases, a shared error code, and one short report whose duplicate is buried in a long multi-topic report.
- **Hard negatives:** the same vocabulary for unrelated failures ("timeout" in an upload and in a test runner; the same `ENOENT` with different causes; a feature request and a bug report about the same dialog).
- **Negation conflicts:** one report affirms what the other negates ("data loss" against "no data loss", "crashes on startup" against "does not crash on startup").
- **Template noise:** reports that share only a long issue template.

Background items with no pair give realistic word frequencies. Items are scored through the github-maintainer pack's engine (masking, negation) exactly as `snapshot run` does. A predicted link between two items with no label counts as a false link.

## Procedure And Disclosure

1. The features, the suffix folding and the word-level contradiction guard were designed while looking at the development set only.
2. The held-out set was written separately and never used to choose features or thresholds.
3. The thresholds the release brief proposed (0.72 and 0.50) were measured first. They were then changed on the development set only, to the lowest values on a 0.05 grid at which no labelled negative pair is linked: 0.45 for `possible_duplicate` (the highest negative scored 0.4127) and 0.25 for `same_symptom` (the highest negative with a shared error code scored 0.2103).
4. The held-out set was scored three times: with the first version of the algorithm at the brief's thresholds (precision 2 of 2, recall 2 of 8), after the development-set changes, and after a bug fix found by a synthetic property test (the rare-feature cutoff dropped bursts of more than five identical reports). The fix did not change any development or held-out number. Nothing was tuned on the held-out results.

## Results

From `results.json` (precision = correct links / links proposed; recall = same-problem pairs linked / same-problem pairs; Wilson 95% intervals):

| Set | Thresholds | Precision | Interval | Recall | Interval |
| --- | --- | --- | --- | --- | --- |
| Development | shipped 0.45 / 0.25 | 6 of 6 | 61% to 100% | 6 of 15 | 20% to 64% |
| Held-out | shipped 0.45 / 0.25 | 5 of 5 | 57% to 100% | 5 of 8 | 31% to 86% |
| Development | brief 0.72 / 0.50 | 3 of 3 | 44% to 100% | 3 of 15 | 7% to 45% |
| Held-out | brief 0.72 / 0.50 | 3 of 3 | 44% to 100% | 3 of 8 | 14% to 69% |

No hard negative, negation conflict or template-noise pair is linked on either set at either setting. The contradiction guard suppressed one pair on each set at the shipped thresholds. `results.json` lists every missed pair; they include both buried-duplicate cases.

## Limits

The sets are small and synthetic, written by the same team that wrote the algorithm, in English only. They show what the method does on the kinds of cases they contain; they do not predict precision or recall on a real repository. Scores are ranking signals, not probabilities.
