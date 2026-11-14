# GitHub Maintainer Benchmark

150 synthetic issues and pull requests for a fictional project, `acme/widget`, each with a gold tier, a category and a one-line rationale. None is copied from or modelled on a real person's issue.

## Files

| File | Contents |
| --- | --- |
| `LABELLING-GUIDE.md` | Tiers, label floors, categories, hard-case quotas. |
| `raw/part-a.jsonl` | All 150 cases. |
| `dev.jsonl` | 60 cases (18 T1, 15 T2, 27 T3): the rules were written against these. |
| `test.jsonl` | 90 cases (27 T1, 22 T2, 41 T3): run once after the rules were frozen. |
| `annotations.test.jsonl` | 13 annotations from a blind review pass over the test review queue. |

Composition: 45 T1 (security 11, data loss 13, regression in the latest release 8, will not start 6, build or install broken 6, label floor 1), 37 T2, 68 T3, including 13 "urgent words only" issues that shout but are not urgent, negated mentions ("no data was lost"), look-alikes ("token count", "crash course"), buried facts in logs, plain-word descriptions and 16 pull requests.

## Procedure

Same as the radiology benchmark: guide first, cases written by a separate agent session without access to rules, seeded stratified split (seed 20261114, 60% test), rules tuned on dev only, test run once, then a blind review pass by another agent session that saw only the review queue. After the first test run (19 of 27 T1 rules-only, 27 of 27 with annotations) the rules were changed once, to remove false positives seen on three live repositories, not to fit this split. The change is listed in `CHANGELOG.md`; on this split it cost one T1 and two T2 cases and is reported as it came out. The annotations were not rewritten afterwards, so the T1 case the new rules miss was never shown to the blind reviewer. Later, the keyword rule for pull requests was replaced by inheritance: a pull request takes the tier of the issue it fixes. The labelling guide gives such a pull request T2 when the issue is T1, and the labels were not changed to match, so two test pull requests now count as over-triage (T1 against gold T2); one T2 pull request whose issue is not in the split lost its flag. Template and boilerplate masking changed no case here: the cases have no repository templates, and no line repeats across enough of them.

## Results

<!-- bench:github-maintainer:start -->
| Split | Mode | Items | Gold T1 | T1 caught | T1 sensitivity | Wilson 95% CI | Missed T1 | Over-triage | False flags | Kendall tau-b |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| dev | rules only | 60 | 18 | 18 | 100.0% | 82.4% to 100.0% | 0 | 7.1% | 7.4% | 0.715 |
| test | rules only | 90 | 27 | 18 | 66.7% | 47.8% to 81.4% | 9 | 15.9% | 17.1% | 0.347 |
| test | rules + annotations | 90 | 27 | 26 | 96.3% | 81.7% to 99.3% | 1 | 15.9% | 17.1% | 0.568 |

Reproduce:

```bash
node scripts/urgent-first.mjs eval github-maintainer bench/github-maintainer/dev.jsonl
node scripts/urgent-first.mjs eval github-maintainer bench/github-maintainer/test.jsonl --annotations bench/github-maintainer/annotations.test.jsonl
```
<!-- bench:github-maintainer:end -->

The test split has 27 T1 issues, so even a perfect score has a lower bound near 87.5%; read the missed list rather than the percentage.
