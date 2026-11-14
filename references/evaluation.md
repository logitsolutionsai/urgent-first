# Evaluation

`urgent-first eval <pack> <labelled.jsonl> [--annotations FILE] [--json] [--strict]` runs the pack on labelled items (gold labels are removed before the engine sees them) and compares the board with `gold.tier`.

## Metrics

| Metric | Definition |
| --- | --- |
| **Missed top-tier items** (headline) | Items with gold in the top tier that the board placed lower, listed with the gold rationale. |
| Top-tier sensitivity | caught / gold top-tier items, with a Wilson 95% interval. |
| Over-triage | Items placed more urgent than gold, among items whose gold tier is not the top tier. |
| False flags | Gold baseline items placed above the baseline. |
| Under-triage | Items placed less urgent than gold, any tier. |
| Exact tier agreement | Placed tier equals gold tier. |
| Ranking quality | Kendall tau-b between board position and gold order (gold tier, then `gold.rank` if given). Higher is better; 1 is perfect agreement. |
| Confusion matrix | Rows gold tier, columns placed tier. |
| Rule hits | Per rule: items matched, how many had a gold tier at least as urgent as the rule, how many less urgent. |
| Flag precision | Items with a gold tier above the baseline among the items placed above it (the Discuss First list), with a Wilson 95% interval. Undefined when nothing is flagged. |
| Flag recall | Items placed above the baseline among items whose gold tier is above it, with a Wilson 95% interval. |

With `--annotations`, the same metrics are shown for rules only and for rules plus the accepted annotations, side by side, with the annotation validation summary. `--strict` exits with code 4 if any top-tier item is missed. `--json` prints everything as JSON.

## Wilson Interval

For x caught out of n, with z = 1.959964 (95%):

centre = (p + z²/2n) / (1 + z²/n), half-width = z √(p(1−p)/n + z²/4n²) / (1 + z²/n), with p = x/n.

Worked example (also a unit test): 8 of 10 gives p = 0.8, centre 0.7167, half-width 0.2266, interval 49.0% to 94.3%.

When nothing is missed (x = n) the lower bound is n / (n + z²). It reaches 95% only from n = 73. That is why the radiology benchmark puts 81 gold T1 cases in its test split: a zero-miss result there would mean a lower bound of 95.5%. With fewer cases, a perfect score still has a wide interval; report the interval, not just the percentage.

## Kendall Tau-b

τ_b = (C − D) / √((n₀ − n₁)(n₀ − n₂)), with C and D the concordant and discordant pairs, n₀ = n(n−1)/2, and n₁, n₂ the pairs tied in each ranking. Worked examples (unit tests): `[1,2,3,4]` against `[1,3,2,4]` gives 4/6 = 0.667; against `[1,1,2,2]` gives 4/√24 = 0.816. Gold tiers have many ties, so tau-b stays well below 1 even for a good board.

## Development And Test Procedure

The procedure used for the bundled benchmarks, and the one to use for your own pack:

1. Write a labelling guide (tiers, categories, hard cases) before any rule exists.
2. Write cases from the guide without looking at the rules. The bundled cases were written by separate AI agent sessions that saw only the guide.
3. Split with a seeded, stratified shuffle (`node scripts/split-bench.js bench/<name> --test-fraction 0.6`), before reading any case.
4. Author and tune rules on `dev.jsonl` only.
5. Run `test.jsonl` once the rules are frozen, and report the result as it is, including every miss. Do not tune on test. If a later code fix changes test numbers, say so in the changelog.
6. Optional: run the annotation step blind (the reviewer sees `review.md`, never the gold labels) and report rules only and rules plus annotations side by side.

`npm run bench` regenerates `bench/results.json` and the tables in the READMEs; `npm test` fails if the published numbers no longer match what `eval` prints.
