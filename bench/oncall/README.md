# On-Call Benchmark

40 synthetic support and on-call tickets for a fictional hosted notes service, with gold tiers, categories and rationales. Many are deliberately mis-prioritised (a P3 that is an outage, a P1 that is a how-to question). See `LABELLING-GUIDE.md`.

| File | Contents |
| --- | --- |
| `raw/part-a.jsonl` | All 40 tickets. |
| `dev.jsonl` | 15 tickets (5 T1). |
| `test.jsonl` | 25 tickets (8 T1). |
| `annotations.test.jsonl` | 4 annotations from a blind review pass. |

## Results

<!-- bench:oncall:start -->
| Split | Mode | Items | Gold T1 | T1 caught | T1 sensitivity | Wilson 95% CI | Missed T1 | Over-triage | False flags | Kendall tau-b |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| dev | rules only | 15 | 5 | 5 | 100.0% | 56.5% to 100.0% | 0 | 0.0% | 0.0% | 0.840 |
| test | rules only | 25 | 8 | 6 | 75.0% | 40.9% to 92.8% | 2 | 23.5% | 20.0% | 0.539 |
| test | rules + annotations | 25 | 8 | 8 | 100.0% | 67.6% to 100.0% | 0 | 23.5% | 20.0% | 0.676 |

Reproduce:

```bash
node scripts/urgent-first.mjs eval oncall bench/oncall/dev.jsonl
node scripts/urgent-first.mjs eval oncall bench/oncall/test.jsonl --annotations bench/oncall/annotations.test.jsonl
```
<!-- bench:oncall:end -->

This set is small: 8 T1 tickets in test give a very wide interval. It shows the pack format working on a third kind of queue; it does not measure a product.
