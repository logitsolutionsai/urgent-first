# Radiology Research Benchmark

300 synthetic imaging orders with a gold urgency tier, a category and a one-line rationale each. As far as we know it is the first public benchmark of urgency labels on order text.

**The cases are synthetic and have not been adjudicated by clinicians.** They were written by AI agents from `LABELLING-GUIDE.md`, using public guideline facts, and contain no real or de-identified patient text. Clinicians are warmly invited to review the labels, flag disagreements and contribute cases (see `CONTRIBUTING.md`); until then the gold labels are one careful reading, not a reference standard.

## Files

| File | Contents |
| --- | --- |
| `LABELLING-GUIDE.md` | Tiers, floor rule, categories, hard-case quotas: the policy every case follows. |
| `raw/part-a.jsonl` | 100 cases: neurology, head and neck, spine. |
| `raw/part-b.jsonl` | 100 cases: chest, heart, vessels, musculoskeletal. |
| `raw/part-c.jsonl` | 100 cases: abdomen, pelvis, obstetrics and gynaecology, urology, paediatrics. |
| `dev.jsonl` | 120 cases (54 T1, 30 T2, 36 T3): the rules were written against these. |
| `test.jsonl` | 180 cases (81 T1, 45 T2, 54 T3): run once after the rules were frozen. |
| `annotations.test.jsonl` | 18 annotations from a blind review pass over the test review queue. |

Composition: 135 T1, 75 T2, 90 T3. Of the T1 cases, 40 were ordered `stat`, 41 `urgent` or `asap` and 54 `routine`: the under-prioritised orders are the point. Hard cases include suspicion phrasing ("r/o PE", "?SAH"), negations and history ("no history of stroke", "PE ruled out in July"), abbreviations, typing errors in the key word, cues buried at the end of long histories, conditions described without their name, look-alikes ("stroke volume", "tibial torsion", "ectopic kidney", "neck dissection"), numbers (SpO2, GCS, heart rate) and clocks ("LKW 07:40").

## Procedure

1. The labelling guide was written first.
2. Three agent sessions wrote 100 cases each from the guide, without access to any rule or code.
3. The 300 cases were split with a seeded, stratified shuffle (`node scripts/split-bench.js bench/radiology-research --test-fraction 0.6`, seed 20261114), strata by source file and gold tier.
4. Rules were written and tuned against `dev.jsonl` only.
5. `test.jsonl` was run once with the frozen rules. Those numbers are published as they came out. No rule's match conditions changed after that run (one rule title and one citation were reworded). A few engine and pack settings changed afterwards for reasons unrelated to the misses (listed in `CHANGELOG.md`: a comma inside a phrase no longer breaks it, a default "non" negation cue, the radiology pack no longer searches the procedure title); re-running the test split after them gave the same value on every published metric.
6. A separate agent session, which saw only the review queue of the test run and the pack's `review.md` (never the gold labels or this folder), wrote `annotations.test.jsonl`.

Two details a reviewer should know: the case writers' summaries named a few test cases while the work was in progress, and the agent that wrote the rules saw the list of missed test cases after step 5. Neither led to a rule change, but the review guidance (`packs/radiology-research/review.md`) was written after step 5; its examples come from the development split and the labelling guide only.

## Results

<!-- bench:radiology-research:start -->
| Split | Mode | Items | Gold T1 | T1 caught | T1 sensitivity | Wilson 95% CI | Missed T1 | Over-triage | False flags | Kendall tau-b |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| dev | rules only | 120 | 54 | 54 | 100.0% | 93.4% to 100.0% | 0 | 0.0% | 0.0% | 0.804 |
| test | rules only | 180 | 81 | 68 | 84.0% | 74.5% to 90.4% | 13 | 9.1% | 11.1% | 0.627 |
| test | rules + annotations | 180 | 81 | 81 | 100.0% | 95.5% to 100.0% | 0 | 9.1% | 11.1% | 0.736 |

Reproduce:

```bash
node scripts/urgent-first.mjs eval radiology-research bench/radiology-research/dev.jsonl
node scripts/urgent-first.mjs eval radiology-research bench/radiology-research/test.jsonl --annotations bench/radiology-research/annotations.test.jsonl
```
<!-- bench:radiology-research:end -->

The 95% interval is a Wilson score interval. With 81 gold T1 cases in test, a result with no misses would have a lower bound of 95.5%.

## Case Format

See `LABELLING-GUIDE.md`. Each line is one item in the urgent-first item schema plus `gold`:

```json
{"id":"rad-a-013","synthetic":true,"title":"MRI lumbar spine without contrast","priority":"stat","location":"ED","created_at":"...","text":{"reason":"?CES. LBP 1 wk, now bilat sciatica, saddle anesthesia since this pm ..."},"metadata":{"modality":"MR","encounter_class":"EMER"},"gold":{"tier":"T1","category":"cauda_equina","rationale":"..."}}
```

## Licence

MIT, like the rest of the repository. The cases are invented; any resemblance to a real person is coincidental.
